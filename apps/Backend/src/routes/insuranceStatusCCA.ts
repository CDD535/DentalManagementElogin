import { Router, Request, Response } from "express";
import { storage } from "../storage";
import {
  forwardToSeleniumCCAEligibilityAgent,
  getSeleniumCCASessionStatus,
} from "../services/seleniumCCAInsuranceEligibilityClient";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import PDFDocument from "pdfkit";
import { emptyFolderContainingFile } from "../utils/emptyTempFolder";
import {
  InsertPatient,
  insertPatientSchema,
} from "../../../../packages/db/types/patient-types";
import { io } from "../socket";

const router = Router();

interface CCAJobContext {
  userId: number;
  insuranceEligibilityData: any;
  socketId?: string;
}

const ccaJobs: Record<string, CCAJobContext> = {};

function splitName(fullName?: string | null) {
  if (!fullName) return { firstName: "", lastName: "" };
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const firstName = parts.shift() ?? "";
  const lastName = parts.join(" ") ?? "";
  return { firstName, lastName };
}

async function imageToPdfBuffer(imagePath: string): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ autoFirstPage: false });
      const chunks: Uint8Array[] = [];

      doc.on("data", (chunk: any) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", (err: any) => reject(err));

      const A4_WIDTH = 595.28;
      const A4_HEIGHT = 841.89;

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

async function createOrUpdatePatientByInsuranceId(options: {
  insuranceId: string;
  firstName?: string | null;
  lastName?: string | null;
  dob?: string | Date | null;
  userId: number;
  eligibilityStatus?: string;
}) {
  const { insuranceId, firstName, lastName, dob, userId, eligibilityStatus } =
    options;
  if (!insuranceId) throw new Error("Missing insuranceId");

  const incomingFirst = (firstName || "").trim();
  const incomingLast = (lastName || "").trim();

  let patient = await storage.getPatientByInsuranceId(insuranceId);

  if (patient && patient.id) {
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
    console.log(
      `[cca-eligibility] Creating new patient: ${incomingFirst} ${incomingLast} with status: ${eligibilityStatus || "UNKNOWN"}`
    );
    const createPayload: any = {
      firstName: incomingFirst,
      lastName: incomingLast,
      dateOfBirth: dob,
      gender: "Unknown",
      phone: "",
      userId,
      insuranceId,
      insuranceProvider: "CCA",
      status: eligibilityStatus || "UNKNOWN",
    };
    let patientData: InsertPatient;
    try {
      patientData = insertPatientSchema.parse(createPayload);
    } catch (err) {
      const safePayload = { ...createPayload };
      delete (safePayload as any).dateOfBirth;
      patientData = insertPatientSchema.parse(safePayload);
    }
    const newPatient = await storage.createPatient(patientData);
    console.log(
      `[cca-eligibility] Created new patient: ${newPatient.id} with status: ${eligibilityStatus || "UNKNOWN"}`
    );
  }
}

async function handleCCACompletedJob(
  sessionId: string,
  job: CCAJobContext,
  seleniumResult: any
) {
  let createdPdfFileId: number | null = null;
  let generatedPdfPath: string | null = null;
  const outputResult: any = {};

  try {
    const insuranceEligibilityData = job.insuranceEligibilityData;

    let insuranceId = String(seleniumResult?.memberId ?? "").trim();
    if (!insuranceId) {
      insuranceId = String(insuranceEligibilityData.memberId ?? "").trim();
    }

    if (!insuranceId) {
      console.log(
        "[cca-eligibility] No Member ID found - will use name for patient lookup"
      );
    } else {
      console.log(`[cca-eligibility] Using Member ID: ${insuranceId}`);
    }

    const patientNameFromResult =
      typeof seleniumResult?.patientName === "string"
        ? seleniumResult.patientName.trim()
        : null;

    let firstName = insuranceEligibilityData.firstName || "";
    let lastName = insuranceEligibilityData.lastName || "";

    if (patientNameFromResult) {
      const parsedName = splitName(patientNameFromResult);
      firstName = parsedName.firstName || firstName;
      lastName = parsedName.lastName || lastName;
    }

    const rawEligibility = String(
      seleniumResult?.eligibility ?? ""
    ).toLowerCase();
    const eligibilityStatus =
      rawEligibility.includes("active") || rawEligibility.includes("eligible")
        ? "ACTIVE"
        : "INACTIVE";
    console.log(`[cca-eligibility] Eligibility status: ${eligibilityStatus}`);

    // Extract extra patient data from selenium result
    const extractedAddress = String(seleniumResult?.address ?? "").trim();
    const extractedCity = String(seleniumResult?.city ?? "").trim();
    const extractedZip = String(seleniumResult?.zipCode ?? "").trim();
    const extractedInsurer = String(seleniumResult?.insurerName ?? "").trim() || "CCA";

    if (extractedAddress || extractedCity || extractedZip) {
      console.log(`[cca-eligibility] Extra data: address=${extractedAddress}, city=${extractedCity}, zip=${extractedZip}, insurer=${extractedInsurer}`);
    }

    if (insuranceId) {
      await createOrUpdatePatientByInsuranceId({
        insuranceId,
        firstName,
        lastName,
        dob: insuranceEligibilityData.dateOfBirth,
        userId: job.userId,
        eligibilityStatus,
      });
    }

    let patient = insuranceId
      ? await storage.getPatientByInsuranceId(insuranceId)
      : null;

    if (!patient?.id && firstName && lastName) {
      const patients = await storage.getAllPatients(job.userId);
      patient =
        patients.find(
          (p) =>
            p.firstName?.toLowerCase() === firstName.toLowerCase() &&
            p.lastName?.toLowerCase() === lastName.toLowerCase()
        ) ?? null;
      if (patient) {
        console.log(
          `[cca-eligibility] Found patient by name: ${patient.id}`
        );
      }
    }

    if (!patient && firstName && lastName) {
      console.log(
        `[cca-eligibility] Creating new patient: ${firstName} ${lastName}`
      );
      try {
        let parsedDob: Date | undefined = undefined;
        if (insuranceEligibilityData.dateOfBirth) {
          try {
            parsedDob = new Date(insuranceEligibilityData.dateOfBirth);
            if (isNaN(parsedDob.getTime())) parsedDob = undefined;
          } catch {
            parsedDob = undefined;
          }
        }

        const newPatientData: InsertPatient = {
          firstName,
          lastName,
          dateOfBirth: parsedDob || new Date(),
          insuranceId: insuranceId || undefined,
          insuranceProvider: extractedInsurer,
          gender: "Unknown",
          phone: "",
          userId: job.userId,
          status: eligibilityStatus,
          address: extractedAddress || undefined,
          city: extractedCity || undefined,
          zipCode: extractedZip || undefined,
        };

        const validation = insertPatientSchema.safeParse(newPatientData);
        if (validation.success) {
          patient = await storage.createPatient(validation.data);
          console.log(
            `[cca-eligibility] Created new patient: ${patient.id}`
          );
        } else {
          console.log(
            `[cca-eligibility] Patient validation failed: ${validation.error.message}`
          );
        }
      } catch (createErr: any) {
        console.log(
          `[cca-eligibility] Failed to create patient: ${createErr.message}`
        );
      }
    }

    if (!patient?.id) {
      outputResult.patientUpdateStatus =
        "Patient not found and could not be created; no update performed";
      return {
        patientUpdateStatus: outputResult.patientUpdateStatus,
        pdfUploadStatus: "none",
        pdfFileId: null,
      };
    }

    const updatePayload: Record<string, any> = {
      status: eligibilityStatus,
      insuranceProvider: extractedInsurer,
    };
    if (firstName && (!patient.firstName || patient.firstName.trim() === "")) {
      updatePayload.firstName = firstName;
    }
    if (lastName && (!patient.lastName || patient.lastName.trim() === "")) {
      updatePayload.lastName = lastName;
    }
    if (extractedAddress && (!patient.address || patient.address.trim() === "")) {
      updatePayload.address = extractedAddress;
    }
    if (extractedCity && (!patient.city || patient.city.trim() === "")) {
      updatePayload.city = extractedCity;
    }
    if (extractedZip && (!patient.zipCode || patient.zipCode.trim() === "")) {
      updatePayload.zipCode = extractedZip;
    }

    await storage.updatePatient(patient.id, updatePayload);
    outputResult.patientUpdateStatus = `Patient ${patient.id} updated: status=${eligibilityStatus}, insuranceProvider=${extractedInsurer}, name=${firstName} ${lastName}, address=${extractedAddress}, city=${extractedCity}, zip=${extractedZip}`;
    console.log(`[cca-eligibility] ${outputResult.patientUpdateStatus}`);

    // Handle PDF
    let pdfBuffer: Buffer | null = null;

    if (
      seleniumResult?.pdfBase64 &&
      typeof seleniumResult.pdfBase64 === "string" &&
      seleniumResult.pdfBase64.length > 100
    ) {
      try {
        pdfBuffer = Buffer.from(seleniumResult.pdfBase64, "base64");
        const pdfFileName = `cca_eligibility_${insuranceId || "unknown"}_${Date.now()}.pdf`;
        const downloadDir = path.join(process.cwd(), "seleniumDownloads");
        if (!fsSync.existsSync(downloadDir)) {
          fsSync.mkdirSync(downloadDir, { recursive: true });
        }
        generatedPdfPath = path.join(downloadDir, pdfFileName);
        await fs.writeFile(generatedPdfPath, pdfBuffer);
        console.log(
          `[cca-eligibility] PDF saved from base64: ${generatedPdfPath}`
        );
      } catch (pdfErr: any) {
        console.error(
          `[cca-eligibility] Failed to save base64 PDF: ${pdfErr.message}`
        );
        pdfBuffer = null;
      }
    }

    if (
      !pdfBuffer &&
      seleniumResult?.ss_path &&
      typeof seleniumResult.ss_path === "string"
    ) {
      try {
        if (!fsSync.existsSync(seleniumResult.ss_path)) {
          throw new Error(`File not found: ${seleniumResult.ss_path}`);
        }

        if (seleniumResult.ss_path.endsWith(".pdf")) {
          pdfBuffer = await fs.readFile(seleniumResult.ss_path);
          generatedPdfPath = seleniumResult.ss_path;
          seleniumResult.pdf_path = generatedPdfPath;
        } else if (
          seleniumResult.ss_path.endsWith(".png") ||
          seleniumResult.ss_path.endsWith(".jpg") ||
          seleniumResult.ss_path.endsWith(".jpeg")
        ) {
          pdfBuffer = await imageToPdfBuffer(seleniumResult.ss_path);
          const pdfFileName = `cca_eligibility_${insuranceId || "unknown"}_${Date.now()}.pdf`;
          generatedPdfPath = path.join(
            path.dirname(seleniumResult.ss_path),
            pdfFileName
          );
          await fs.writeFile(generatedPdfPath, pdfBuffer);
          seleniumResult.pdf_path = generatedPdfPath;
        }
      } catch (err: any) {
        console.error(
          "[cca-eligibility] Failed to process PDF/screenshot:",
          err
        );
        outputResult.pdfUploadStatus = `Failed to process file: ${String(err)}`;
      }
    }

    if (pdfBuffer && generatedPdfPath) {
      const groupTitle = "Eligibility Status";
      const groupTitleKey = "ELIGIBILITY_STATUS";

      let group = await storage.findPdfGroupByPatientTitleKey(
        patient.id,
        groupTitleKey
      );
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
        path.basename(generatedPdfPath),
        pdfBuffer
      );
      if (created && typeof created === "object" && "id" in created) {
        createdPdfFileId = Number(created.id);
      }
      outputResult.pdfUploadStatus = `PDF saved to group: ${group.title}`;
    } else if (!outputResult.pdfUploadStatus) {
      outputResult.pdfUploadStatus = "No PDF available from Selenium";
    }

    const pdfFilename = generatedPdfPath
      ? path.basename(generatedPdfPath)
      : null;

    return {
      patientUpdateStatus: outputResult.patientUpdateStatus,
      pdfUploadStatus: outputResult.pdfUploadStatus,
      pdfFileId: createdPdfFileId,
      pdfFilename,
    };
  } catch (err: any) {
    const pdfFilename = generatedPdfPath
      ? path.basename(generatedPdfPath)
      : null;
    return {
      patientUpdateStatus: outputResult.patientUpdateStatus,
      pdfUploadStatus:
        outputResult.pdfUploadStatus ??
        `Failed to process CCA job: ${err?.message ?? String(err)}`,
      pdfFileId: createdPdfFileId,
      pdfFilename,
      error: err?.message ?? String(err),
    };
  } finally {
    try {
      if (seleniumResult && seleniumResult.pdf_path) {
        await emptyFolderContainingFile(seleniumResult.pdf_path);
      } else if (seleniumResult && seleniumResult.ss_path) {
        await emptyFolderContainingFile(seleniumResult.ss_path);
      }
    } catch (cleanupErr) {
      console.error(`[cca-eligibility cleanup failed]`, cleanupErr);
    }
  }
}

let currentFinalSessionId: string | null = null;
let currentFinalResult: any = null;

function now() {
  return new Date().toISOString();
}
function log(tag: string, msg: string, ctx?: any) {
  console.log(`${now()} [${tag}] ${msg}`, ctx ?? "");
}

function emitSafe(socketId: string | undefined, event: string, payload: any) {
  if (!socketId) {
    log("socket", "no socketId for emit", { event });
    return;
  }
  try {
    const socket = io?.sockets.sockets.get(socketId);
    if (!socket) {
      log("socket", "socket not found (maybe disconnected)", {
        socketId,
        event,
      });
      return;
    }
    socket.emit(event, payload);
    log("socket", "emitted", { socketId, event });
  } catch (err: any) {
    log("socket", "emit failed", { socketId, event, err: err?.message });
  }
}

async function pollAgentSessionAndProcess(
  sessionId: string,
  socketId?: string,
  pollTimeoutMs = 4 * 60 * 1000
) {
  const maxAttempts = 300;
  const baseDelayMs = 1000;
  const maxTransientErrors = 12;
  const noProgressLimit = 200;

  const job = ccaJobs[sessionId];
  let transientErrorCount = 0;
  let consecutiveNoProgress = 0;
  let lastStatus: string | null = null;
  const deadline = Date.now() + pollTimeoutMs;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (Date.now() > deadline) {
      emitSafe(socketId, "selenium:session_update", {
        session_id: sessionId,
        status: "error",
        message: `Polling timeout reached (${Math.round(pollTimeoutMs / 1000)}s).`,
      });
      delete ccaJobs[sessionId];
      return;
    }

    log(
      "poller-cca",
      `attempt=${attempt} session=${sessionId} transientErrCount=${transientErrorCount}`
    );

    try {
      const st = await getSeleniumCCASessionStatus(sessionId);
      const status = st?.status ?? null;
      log("poller-cca", "got status", {
        sessionId,
        status,
        message: st?.message,
        resultKeys: st?.result ? Object.keys(st.result) : null,
      });

      transientErrorCount = 0;

      const isTerminalLike =
        status === "completed" || status === "error" || status === "not_found";
      if (status === lastStatus && !isTerminalLike) {
        consecutiveNoProgress++;
      } else {
        consecutiveNoProgress = 0;
      }
      lastStatus = status;

      if (consecutiveNoProgress >= noProgressLimit) {
        emitSafe(socketId, "selenium:session_update", {
          session_id: sessionId,
          status: "error",
          message: `No progress from selenium agent (status="${status}") after ${consecutiveNoProgress} polls; aborting.`,
        });
        emitSafe(socketId, "selenium:session_error", {
          session_id: sessionId,
          status: "error",
          message: "No progress from selenium agent",
        });
        delete ccaJobs[sessionId];
        return;
      }

      emitSafe(socketId, "selenium:debug", {
        session_id: sessionId,
        attempt,
        status,
        serverTime: new Date().toISOString(),
      });

      if (status === "completed") {
        log("poller-cca", "agent completed; processing result", {
          sessionId,
          resultKeys: st.result ? Object.keys(st.result) : null,
        });

        currentFinalSessionId = sessionId;
        currentFinalResult = {
          rawSelenium: st.result,
          processedAt: null,
          final: null,
        };

        let finalResult: any = null;
        if (job && st.result) {
          try {
            finalResult = await handleCCACompletedJob(
              sessionId,
              job,
              st.result
            );
            currentFinalResult.final = finalResult;
            currentFinalResult.processedAt = Date.now();
          } catch (err: any) {
            currentFinalResult.final = {
              error: "processing_failed",
              detail: err?.message ?? String(err),
            };
            currentFinalResult.processedAt = Date.now();
            log("poller-cca", "handleCCACompletedJob failed", {
              sessionId,
              err: err?.message ?? err,
            });
          }
        } else {
          currentFinalResult.final = {
            error: "no_job_or_no_result",
          };
          currentFinalResult.processedAt = Date.now();
        }

        emitSafe(socketId, "selenium:session_update", {
          session_id: sessionId,
          status: "completed",
          rawSelenium: st.result,
          final: currentFinalResult.final,
        });

        delete ccaJobs[sessionId];
        return;
      }

      if (status === "error" || status === "not_found") {
        const emitPayload = {
          session_id: sessionId,
          status,
          message: st?.message || "Selenium session error",
        };
        emitSafe(socketId, "selenium:session_update", emitPayload);
        emitSafe(socketId, "selenium:session_error", emitPayload);
        delete ccaJobs[sessionId];
        return;
      }
    } catch (err: any) {
      const axiosStatus =
        err?.response?.status ?? (err?.status ? Number(err.status) : undefined);
      const errCode = err?.code ?? err?.errno;
      const errMsg = err?.message ?? String(err);
      const errData = err?.response?.data ?? null;

      if (
        axiosStatus === 404 ||
        (typeof errMsg === "string" && errMsg.includes("not_found"))
      ) {
        console.warn(
          `${new Date().toISOString()} [poller-cca] terminal 404/not_found for ${sessionId}`
        );

        const emitPayload = {
          session_id: sessionId,
          status: "not_found",
          message:
            errData?.detail || "Selenium session not found (agent cleaned up).",
        };
        emitSafe(socketId, "selenium:session_update", emitPayload);
        emitSafe(socketId, "selenium:session_error", emitPayload);

        delete ccaJobs[sessionId];
        return;
      }

      transientErrorCount++;
      if (transientErrorCount > maxTransientErrors) {
        const emitPayload = {
          session_id: sessionId,
          status: "error",
          message:
            "Repeated network errors while polling selenium agent; giving up.",
        };
        emitSafe(socketId, "selenium:session_update", emitPayload);
        emitSafe(socketId, "selenium:session_error", emitPayload);
        delete ccaJobs[sessionId];
        return;
      }

      const backoffMs = Math.min(
        30_000,
        baseDelayMs * Math.pow(2, transientErrorCount - 1)
      );
      console.warn(
        `${new Date().toISOString()} [poller-cca] transient error (#${transientErrorCount}) for ${sessionId}: code=${errCode} status=${axiosStatus} msg=${errMsg}`
      );

      await new Promise((r) => setTimeout(r, backoffMs));
      continue;
    }

    await new Promise((r) => setTimeout(r, baseDelayMs));
  }

  emitSafe(socketId, "selenium:session_update", {
    session_id: sessionId,
    status: "error",
    message: "Polling timeout while waiting for selenium session",
  });
  delete ccaJobs[sessionId];
}

router.post(
  "/cca-eligibility",
  async (req: Request, res: Response): Promise<any> => {
    if (!req.body.data) {
      return res
        .status(400)
        .json({ error: "Missing Insurance Eligibility data for selenium" });
    }

    if (!req.user || !req.user.id) {
      return res.status(401).json({ error: "Unauthorized: user info missing" });
    }

    try {
      const rawData =
        typeof req.body.data === "string"
          ? JSON.parse(req.body.data)
          : req.body.data;

      const credentials = await storage.getInsuranceCredentialByUserAndSiteKey(
        req.user.id,
        "CCA"
      );
      if (!credentials) {
        return res.status(404).json({
          error:
            "No insurance credentials found for this provider, Kindly Update this at Settings Page.",
        });
      }

      const enrichedData = {
        ...rawData,
        cca_username: credentials.username,
        cca_password: credentials.password,
      };

      const socketId: string | undefined = req.body.socketId;

      const agentResp =
        await forwardToSeleniumCCAEligibilityAgent(enrichedData);

      if (
        !agentResp ||
        agentResp.status !== "started" ||
        !agentResp.session_id
      ) {
        return res.status(502).json({
          error: "Selenium agent did not return a started session",
          detail: agentResp,
        });
      }

      const sessionId = agentResp.session_id as string;

      ccaJobs[sessionId] = {
        userId: req.user.id,
        insuranceEligibilityData: enrichedData,
        socketId,
      };

      pollAgentSessionAndProcess(sessionId, socketId).catch((e) =>
        console.warn("pollAgentSessionAndProcess (cca) failed", e)
      );

      return res.json({ status: "started", session_id: sessionId });
    } catch (err: any) {
      console.error(err);
      return res.status(500).json({
        error: err.message || "Failed to start CCA selenium agent",
      });
    }
  }
);

router.get(
  "/selenium/session/:sid/final",
  async (req: Request, res: Response) => {
    const sid = req.params.sid;
    if (!sid) return res.status(400).json({ error: "session id required" });

    if (currentFinalSessionId !== sid || !currentFinalResult) {
      return res.status(404).json({ error: "final result not found" });
    }

    return res.json(currentFinalResult);
  }
);

export default router;
