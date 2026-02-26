import { Router } from "express";
import { Request, Response } from "express";
import { storage } from "../storage";
import { forwardToSeleniumInsuranceEligibilityAgent } from "../services/seleniumInsuranceEligibilityClient";
import fs from "fs/promises";
import path from "path";
import PDFDocument from "pdfkit";
import { forwardToSeleniumInsuranceClaimStatusAgent } from "../services/seleniumInsuranceClaimStatusClient";
import fsSync from "fs";
import { emptyFolderContainingFile } from "../utils/emptyTempFolder";
import forwardToPatientDataExtractorService from "../services/patientDataExtractorService";
import {
  InsertPatient,
  insertPatientSchema,
} from "../../../../packages/db/types/patient-types";
import { formatDobForAgent } from "../utils/dateUtils";

const router = Router();

/** Utility: naive name splitter */
function splitName(fullName?: string | null) {
  if (!fullName) return { firstName: "", lastName: "" };
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = parts.shift() ?? "";
  const lastName = parts.join(" ") ?? "";
  return { firstName, lastName };
}

/**
 * Ensure patient exists for given insuranceId.
 * If exists -> update first/last name when different.
 * If not -> create using provided fields.
 * Returns the patient object (the version read from DB after potential create/update).
 */
async function createOrUpdatePatientByInsuranceId(options: {
  insuranceId: string;
  firstName?: string | null;
  lastName?: string | null;
  dob?: string | Date | null;
  userId: number;
}) {
  const { insuranceId, firstName, lastName, dob, userId } = options;
  if (!insuranceId) throw new Error("Missing insuranceId");

  let patient = await storage.getPatientByInsuranceId(insuranceId);

  // Normalize incoming names
  const incomingFirst = firstName!.trim();
  const incomingLast = lastName!.trim();

  if (patient && patient.id) {
    // update only if different
    const updates: any = {};
    if (
      incomingFirst &&
      String(patient.firstName ?? "").trim() !== incomingFirst
    ) {
      updates.firstName = incomingFirst;
    }
    if (
      incomingLast &&
      String(patient.lastName ?? "").trim() !== incomingLast
    ) {
      updates.lastName = incomingLast;
    }

    if (Object.keys(updates).length > 0) {
      await storage.updatePatient(patient.id, updates);
    }
    return;
  } else {
    const createPayload: any = {
      firstName: incomingFirst,
      lastName: incomingLast,
      dateOfBirth: dob,
      gender: "",
      phone: "",
      userId,
      insuranceId,
      insuranceProvider: "MassHealth",
    };

    let patientData: InsertPatient;
    try {
      patientData = insertPatientSchema.parse(createPayload);
    } catch (err) {
      // handle malformed dob or other validation errors conservatively
      console.warn(
        "Failed to validate patient payload in insurance flow:",
        err
      );
      // either rethrow or drop invalid fields — here we drop dob and proceed
      const safePayload = { ...createPayload };
      delete (safePayload as any).dateOfBirth;
      patientData = insertPatientSchema.parse(safePayload);
    }

    await storage.createPatient(patientData);
  }
}

/**
 * /eligibility-check
 * - run selenium
 * - if pdf created -> call extractor -> get name
 * - create or update patient (by memberId)
 * - attach PDF to patient (create pdf group/file)
 * - return { patient, pdfFileId, extractedName ... }
 */
router.post(
  "/eligibility-check",
  async (req: Request, res: Response): Promise<any> => {
    if (!req.body.data) {
      return res
        .status(400)
        .json({ error: "Missing Insurance Eligibility data for selenium" });
    }

    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: "Unauthorized: user info missing" });
    }

    let seleniumResult: any = undefined;
    let createdPdfFileId: number | null = null;
    let outputResult: any = {};
    const extracted: any = {};

    try {
      const insuranceEligibilityData = JSON.parse(req.body.data);

      const credentials = await storage.getInsuranceCredentialByUserAndSiteKey(
        req.user.id,
        insuranceEligibilityData.insuranceSiteKey
      );
      if (!credentials) {
        return res.status(404).json({
          error:
            "No insurance credentials found for this provider, Kindly Update this at Settings Page.",
        });
      }

      const enrichedData = {
        ...insuranceEligibilityData,
        massdhpUsername: credentials.username,
        massdhpPassword: credentials.password,
      };

      // 1) Run selenium agent
      try {
        seleniumResult =
          await forwardToSeleniumInsuranceEligibilityAgent(enrichedData);
      } catch (seleniumErr: any) {
        return res.status(502).json({
          error: "Selenium service failed",
          detail: seleniumErr?.message ?? String(seleniumErr),
        });
      }

      // 2) If selenium produced a pdf path, extract name
      if (
        seleniumResult?.pdf_path &&
        seleniumResult.pdf_path.endsWith(".pdf")
      ) {
        try {
          const pdfPath = seleniumResult.pdf_path;
          const pdfBuffer = await fs.readFile(pdfPath);

          const extraction = await forwardToPatientDataExtractorService({
            buffer: pdfBuffer,
            originalname: path.basename(pdfPath),
            mimetype: "application/pdf",
          } as any);

          if (extraction.name) {
            const parts = splitName(extraction.name);
            extracted.firstName = parts.firstName;
            extracted.lastName = parts.lastName;
          }
        } catch (extractErr: any) {
          return res.status(502).json({
            error: "Patient data extraction failed",
            detail: extractErr?.message ?? String(extractErr),
          });
        }
      }

      // Step-3) Create or update patient name using extracted info (prefer extractor -> request)
      const insuranceId = String(
        insuranceEligibilityData.memberId ?? ""
      ).trim();
      if (!insuranceId) {
        return res.status(400).json({ error: "Missing memberId" });
      }

      // prefer extractor names, else use request-sent names, else null
      const preferFirst = extracted.firstName;
      const preferLast = extracted.lastName;

      try {
        await createOrUpdatePatientByInsuranceId({
          insuranceId,
          firstName: preferFirst,
          lastName: preferLast,
          dob: insuranceEligibilityData.dateOfBirth,
          userId: req.user.id,
        });
      } catch (patientOpErr: any) {
        return res.status(500).json({
          error: "Failed to create/update patient",
          detail: patientOpErr?.message ?? String(patientOpErr),
        });
      }

      // ✅ Step 4: Check result and update patient status
      const patient = await storage.getPatientByInsuranceId(
        insuranceEligibilityData.memberId
      );

      if (patient && patient.id !== undefined) {
        const newStatus =
          seleniumResult.eligibility === "Y" ? "ACTIVE" : "INACTIVE";
        await storage.updatePatient(patient.id, { status: newStatus, insuranceProvider: "MassHealth" });
        outputResult.patientUpdateStatus = `Patient status updated to ${newStatus}, insuranceProvider=MassHealth`;

        // ✅ Step 5: Handle PDF Upload
        if (
          seleniumResult.pdf_path &&
          seleniumResult.pdf_path.endsWith(".pdf")
        ) {
          const pdfBuffer = await fs.readFile(seleniumResult.pdf_path);

          const groupTitle = "Eligibility Status";
          const groupTitleKey = "ELIGIBILITY_STATUS";

          let group = await storage.findPdfGroupByPatientTitleKey(
            patient.id,
            groupTitleKey
          );

          // Step 5b: Create group if it doesn’t exist
          if (!group) {
            group = await storage.createPdfGroup(
              patient.id,
              groupTitle,
              groupTitleKey
            );
          }

          if (!group?.id) {
            throw new Error("PDF group creation failed: missing group ID");
          }

          const created = await storage.createPdfFile(
            group.id,
            path.basename(seleniumResult.pdf_path),
            pdfBuffer
          );

          // created could be { id, filename } or just id, adapt to your storage API.
          if (created && typeof created === "object" && "id" in created) {
            createdPdfFileId = Number(created.id);
          }

          outputResult.pdfUploadStatus = `PDF saved to group: ${group.title}`;
        } else {
          outputResult.pdfUploadStatus =
            "No valid PDF path provided by Selenium, Couldn't upload pdf to server.";
        }
      } else {
        outputResult.patientUpdateStatus =
          "Patient not found or missing ID; no update performed";
      }

      res.json({
        patientUpdateStatus: outputResult.patientUpdateStatus,
        pdfUploadStatus: outputResult.pdfUploadStatus,
        pdfFileId: createdPdfFileId,
      });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({
        error: err.message || "Failed to forward to selenium agent",
      });
    } finally {
      try {
        if (seleniumResult && seleniumResult.pdf_path) {
          await emptyFolderContainingFile(seleniumResult.pdf_path);
        } else {
          console.log(`[eligibility-check] no pdf_path available to cleanup`);
        }
      } catch (cleanupErr) {
        console.error(
          `[eligibility-check cleanup failed for ${seleniumResult?.pdf_path}`,
          cleanupErr
        );
      }
    }
  }
);

router.post(
  "/claim-status-check",
  async (req: Request, res: Response): Promise<any> => {
    if (!req.body.data) {
      return res
        .status(400)
        .json({ error: "Missing Insurance Status data for selenium" });
    }

    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: "Unauthorized: user info missing" });
    }

    let result: any = undefined;

    async function imageToPdfBuffer(imagePath: string): Promise<Buffer> {
      return new Promise<Buffer>((resolve, reject) => {
        try {
          const doc = new PDFDocument({ autoFirstPage: false });
          const chunks: Uint8Array[] = [];

          // collect data chunks
          doc.on("data", (chunk: any) => chunks.push(chunk));
          doc.on("end", () => resolve(Buffer.concat(chunks)));
          doc.on("error", (err: any) => reject(err));

          const A4_WIDTH = 595.28; // points
          const A4_HEIGHT = 841.89; // points

          doc.addPage({ size: [A4_WIDTH, A4_HEIGHT] });

          doc.image(imagePath, 0, 0, {
            fit: [A4_WIDTH, A4_HEIGHT],
            align: "center",
            valign: "center",
          });

          doc.end();
        } catch (err) {
          reject(err);
        }
      });
    }
    try {
      const insuranceClaimStatusData = JSON.parse(req.body.data);

      const credentials = await storage.getInsuranceCredentialByUserAndSiteKey(
        req.user.id,
        insuranceClaimStatusData.insuranceSiteKey
      );
      if (!credentials) {
        return res.status(404).json({
          error:
            "No insurance credentials found for this provider, Kindly Update this at Settings Page.",
        });
      }

      const enrichedData = {
        ...insuranceClaimStatusData,
        massdhpUsername: credentials.username,
        massdhpPassword: credentials.password,
      };

      result = await forwardToSeleniumInsuranceClaimStatusAgent(enrichedData);

      let createdPdfFileId: number | null = null;

      // ✅ Step 1: Check result
      const patient = await storage.getPatientByInsuranceId(
        insuranceClaimStatusData.memberId
      );

      if (patient && patient.id !== undefined) {
        let pdfBuffer: Buffer | null = null;
        let generatedPdfPath: string | null = null;

        if (
          result.ss_path &&
          (result.ss_path.endsWith(".png") ||
            result.ss_path.endsWith(".jpg") ||
            result.ss_path.endsWith(".jpeg"))
        ) {
          try {
            // Ensure file exists
            if (!fsSync.existsSync(result.ss_path)) {
              throw new Error(`Screenshot file not found: ${result.ss_path}`);
            }

            // Convert image to PDF buffer
            pdfBuffer = await imageToPdfBuffer(result.ss_path);

            // Optionally write generated PDF to temp path (so name is available for createPdfFile)
            const pdfFileName = `claimStatus_${insuranceClaimStatusData.memberId}_${Date.now()}.pdf`;
            generatedPdfPath = path.join(
              path.dirname(result.ss_path),
              pdfFileName
            );
            await fs.writeFile(generatedPdfPath, pdfBuffer);
          } catch (err) {
            console.error("Failed to convert screenshot to PDF:", err);
            result.pdfUploadStatus = `Failed to convert screenshot to PDF: ${String(err)}`;
          }
        } else {
          result.pdfUploadStatus =
            "No valid PDF or screenshot path provided by Selenium; nothing to upload.";
        }

        if (pdfBuffer && generatedPdfPath) {
          const groupTitle = "Claim Status";
          const groupTitleKey = "CLAIM_STATUS";

          let group = await storage.findPdfGroupByPatientTitleKey(
            patient.id,
            groupTitleKey
          );

          // Create group if missing
          if (!group) {
            group = await storage.createPdfGroup(
              patient.id,
              groupTitle,
              groupTitleKey
            );
          }

          if (!group?.id) {
            throw new Error("PDF group creation failed: missing group ID");
          }

          // Use the basename for storage
          const basename = path.basename(generatedPdfPath);
          const created = await storage.createPdfFile(
            group.id,
            basename,
            pdfBuffer
          );

          if (created && typeof created === "object" && "id" in created) {
            createdPdfFileId = Number(created.id);
          }

          result.pdfUploadStatus = `PDF saved to group: ${group.title}`;
        }
      } else {
        result.patientUpdateStatus =
          "Patient not found or missing ID; no update performed";
      }

      res.json({
        pdfUploadStatus: result.pdfUploadStatus,
        pdfFileId: createdPdfFileId,
      });
      return;
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({
        error: err.message || "Failed to forward to selenium agent",
      });
    } finally {
      try {
        if (result && result.ss_path) {
          await emptyFolderContainingFile(result.ss_path);
        } else {
          console.log(`claim-status-check] no pdf_path available to cleanup`);
        }
      } catch (cleanupErr) {
        console.error(
          `[claim-status-check cleanup failed for ${result?.ss_path}`,
          cleanupErr
        );
      }
    }
  }
);

router.post(
  "/appointments/check-all-eligibilities",
  async (req: Request, res: Response): Promise<any> => {
    // Query param: date=YYYY-MM-DD (required)
    const date = String(req.query.date ?? "").trim();
    if (!date) {
      return res
        .status(400)
        .json({ error: "Missing date query param (YYYY-MM-DD)" });
    }

    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: "Unauthorized: user info missing" });
    }

    // Track any paths that couldn't be cleaned immediately so we can try again at the end
    const remainingCleanupPaths = new Set<string>();

    try {
      // 1) fetch appointments for the day (reuse your storage API)
      const dayAppointments = await storage.getAppointmentsByDateForUser(
        date,
        req.user.id
      );
      if (!Array.isArray(dayAppointments)) {
        return res
          .status(500)
          .json({ error: "Failed to load appointments for date" });
      }

      const results: Array<any> = [];

      // process sequentially so selenium agent / python semaphore isn't overwhelmed
      for (const apt of dayAppointments) {
        // For each appointment we keep a per-appointment seleniumResult so we can cleanup its files
        let seleniumResult: any = undefined;

        const resultItem: any = {
          appointmentId: apt.id,
          patientId: apt.patientId ?? null,
          processed: false,
          error: null,
          pdfFileId: null,
          patientUpdateStatus: null,
          warning: null,
        };

        try {
          // fetch patient record (use getPatient or getPatientById depending on your storage)
          const patient = apt.patientId
            ? await storage.getPatient(apt.patientId)
            : null;
          const memberId = (patient?.insuranceId ?? "").toString().trim();

          // create a readable patient label for error messages
          const patientLabel = patient
            ? `${patient.firstName ?? ""} ${patient.lastName ?? ""}`.trim() ||
              `patient#${patient.id}`
            : `patient#${apt.patientId ?? "unknown"}`;

          const aptLabel = `appointment#${apt.id}${apt.date ? ` (${apt.date}${apt.startTime ? ` ${apt.startTime}` : ""})` : ""}`;

          if (!memberId) {
            resultItem.error = `Missing insuranceId for ${patientLabel} — skipping ${aptLabel}`;
            results.push(resultItem);
            continue;
          }

          // prepare eligibility data; prefer patient DOB + name if present
          const dob = patient?.dateOfBirth;
          if (!dob) {
            resultItem.error = `Missing dob for ${patientLabel} — skipping ${aptLabel}`;
            results.push(resultItem);
            continue;
          }

          // Convert Date object → YYYY-MM-DD string  - req for selenium agent.
          const dobStr = formatDobForAgent(dob);
          if (!dobStr) {
            resultItem.error = `Invalid or missing DOB for ${patientLabel} — skipping ${aptLabel}`;
            results.push(resultItem);
            continue;
          }

          const payload = {
            memberId,
            dateOfBirth: dobStr,
            insuranceSiteKey: "MH",
          };

          // Get credentials for this user+site
          const credentials =
            await storage.getInsuranceCredentialByUserAndSiteKey(
              req.user.id,
              payload.insuranceSiteKey
            );
          if (!credentials) {
            resultItem.error = `No insurance credentials found for siteKey — skipping ${aptLabel} for ${patientLabel}`;
            results.push(resultItem);
            continue;
          }

          // enrich payload
          const enriched = {
            ...payload,
            massdhpUsername: credentials.username,
            massdhpPassword: credentials.password,
          };

          // forward to selenium agent (sequential)
          try {
            seleniumResult =
              await forwardToSeleniumInsuranceEligibilityAgent(enriched);
          } catch (seleniumErr: any) {
            resultItem.error = `Selenium agent failed for ${patientLabel} (${aptLabel}): ${seleniumErr?.message ?? String(seleniumErr)}`;
            results.push(resultItem);
            continue;
          }

          // Attempt extraction (if pdf_path present)
          const extracted: any = {};
          if (
            seleniumResult?.pdf_path &&
            seleniumResult.pdf_path.endsWith(".pdf")
          ) {
            try {
              const pdfPath = seleniumResult.pdf_path;
              const pdfBuffer = await fs.readFile(pdfPath);

              const extraction = await forwardToPatientDataExtractorService({
                buffer: pdfBuffer,
                originalname: path.basename(pdfPath),
                mimetype: "application/pdf",
              } as any);

              if (extraction.name) {
                const parts = splitName(extraction.name);
                extracted.firstName = parts.firstName;
                extracted.lastName = parts.lastName;
              }
            } catch (extractErr: any) {
              resultItem.warning = `Extraction failed: ${extractErr?.message ?? String(extractErr)}`;
            }
          }

          // create or update patient by insuranceId — prefer extracted name
          const preferFirst = extracted.firstName ?? null;
          const preferLast = extracted.lastName ?? null;
          try {
            await createOrUpdatePatientByInsuranceId({
              insuranceId: memberId,
              firstName: preferFirst,
              lastName: preferLast,
              dob: payload.dateOfBirth,
              userId: req.user.id,
            });
          } catch (patientOpErr: any) {
            resultItem.error = `Failed to create/update patient ${patientLabel} for ${aptLabel}: ${patientOpErr?.message ?? String(patientOpErr)}`;
            results.push(resultItem);
            continue;
          }

          // fetch patient again
          const updatedPatient =
            await storage.getPatientByInsuranceId(memberId);
          if (!updatedPatient || !updatedPatient.id) {
            resultItem.error = `Patient not found after create/update for ${patientLabel} (${aptLabel})`;
            results.push(resultItem);
            continue;
          }

          // Update patient status based on seleniumResult.eligibility
          const newStatus =
            seleniumResult?.eligibility === "Y" ? "ACTIVE" : "INACTIVE";

          // 1. updating patient
          await storage.updatePatient(updatedPatient.id, { status: newStatus, insuranceProvider: "MassHealth" });
          resultItem.patientUpdateStatus = `Patient status updated to ${newStatus}, insuranceProvider=MassHealth`;

          // 2. updating appointment status - for aptmnt page
          try {
            await storage.updateAppointment(Number(apt.id), {
              eligibilityStatus: newStatus,
            });
            resultItem.appointmentUpdateStatus = `Appointment eligibility set to ${newStatus}`;
          } catch (apptUpdateErr: any) {
            resultItem.warning =
              (resultItem.warning ? resultItem.warning + " | " : "") +
              `Failed to update appointment eligibility: ${apptUpdateErr?.message ?? String(apptUpdateErr)}`;
          }

          // If PDF exists, upload to PdfGroup (ELIGIBILITY_STATUS)
          if (
            seleniumResult?.pdf_path &&
            seleniumResult.pdf_path.endsWith(".pdf")
          ) {
            try {
              const pdfBuf = await fs.readFile(seleniumResult.pdf_path);
              const groupTitle = "Eligibility Status";
              const groupTitleKey = "ELIGIBILITY_STATUS";

              let group = await storage.findPdfGroupByPatientTitleKey(
                updatedPatient.id,
                groupTitleKey
              );
              if (!group) {
                group = await storage.createPdfGroup(
                  updatedPatient.id,
                  groupTitle,
                  groupTitleKey
                );
              }
              if (!group?.id)
                throw new Error("Failed to create/find pdf group");

              const created = await storage.createPdfFile(
                group.id,
                path.basename(seleniumResult.pdf_path),
                pdfBuf
              );

              if (created && typeof created === "object" && "id" in created) {
                resultItem.pdfFileId = Number(created.id);
              } else if (typeof created === "number") {
                resultItem.pdfFileId = created;
              } else if (created && (created as any).id) {
                resultItem.pdfFileId = (created as any).id;
              }

              resultItem.processed = true;
            } catch (pdfErr: any) {
              resultItem.warning = `PDF upload failed for ${patientLabel} (${aptLabel}): ${pdfErr?.message ?? String(pdfErr)}`;
            }
          } else {
            // no pdf; still mark processed true (status updated)
            resultItem.processed = true;
            resultItem.pdfFileId = null;
          }

          results.push(resultItem);
        } catch (err: any) {
          resultItem.error = `Unexpected error for appointment#${apt.id}: ${err?.message ?? String(err)}`;
          results.push(resultItem);

          console.error(
            "[batch eligibility] unexpected error for appointment",
            apt.id,
            err
          );
        } finally {
          // Per-appointment cleanup: always try to remove selenium temp files for this appointment
          try {
            if (
              seleniumResult &&
              (seleniumResult.pdf_path || seleniumResult.ss_path)
            ) {
              // prefer pdf_path, fallback to ss_path
              const candidatePath =
                seleniumResult.pdf_path ?? seleniumResult.ss_path;
              try {
                await emptyFolderContainingFile(candidatePath);
              } catch (cleanupErr: any) {
                console.warn(
                  `[batch cleanup] failed to clean ${candidatePath} for appointment ${apt.id}`,
                  cleanupErr
                );
                // remember path for final cleanup attempt
                remainingCleanupPaths.add(candidatePath);
              }
            }
          } catch (cleanupOuterErr: any) {
            console.warn(
              "[batch cleanup] unexpected error during per-appointment cleanup",
              cleanupOuterErr
            );
            // don't throw — we want to continue processing next appointments
          }
        } // end try/catch/finally per appointment
      } // end for appointments

      // return summary
      return res.json({ date, count: results.length, results });
    } catch (err: any) {
      console.error("[check-all-eligibilities] error", err);
      return res
        .status(500)
        .json({ error: err?.message ?? "Internal server error" });
    } finally {
      // Final cleanup attempt for any remaining paths we couldn't delete earlier
      try {
        if (remainingCleanupPaths.size > 0) {
          for (const p of remainingCleanupPaths) {
            try {
              await emptyFolderContainingFile(p);
            } catch (finalCleanupErr: any) {
              console.error(`[final cleanup] failed for ${p}`, finalCleanupErr);
            }
          }
        }
      } catch (outerFinalErr: any) {
        console.error(
          "[check-all-eligibilities final cleanup] unexpected error",
          outerFinalErr
        );
      }
    }
  }
);

export default router;
