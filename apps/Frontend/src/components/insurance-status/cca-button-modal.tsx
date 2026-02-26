import { useEffect, useRef, useState } from "react";
import { io as ioClient, Socket } from "socket.io-client";
import { Button } from "@/components/ui/button";
import { CheckCircle, LoaderCircleIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAppDispatch } from "@/redux/hooks";
import { setTaskStatus } from "@/redux/slices/seleniumEligibilityCheckTaskSlice";
import { formatLocalDate } from "@/utils/dateUtils";
import { QK_PATIENTS_BASE } from "@/components/patients/patient-table";

const SOCKET_URL =
  import.meta.env.VITE_API_BASE_URL_BACKEND ||
  (typeof window !== "undefined" ? window.location.origin : "");

interface CCAEligibilityButtonProps {
  memberId: string;
  dateOfBirth: Date | null;
  firstName?: string;
  lastName?: string;
  isFormIncomplete: boolean;
  onPdfReady: (pdfId: number, fallbackFilename: string | null) => void;
}

export function CCAEligibilityButton({
  memberId,
  dateOfBirth,
  firstName,
  lastName,
  isFormIncomplete,
  onPdfReady,
}: CCAEligibilityButtonProps) {
  const { toast } = useToast();
  const dispatch = useAppDispatch();

  const isCCAFormIncomplete =
    !dateOfBirth || (!memberId && !firstName && !lastName);

  const socketRef = useRef<Socket | null>(null);
  const connectingRef = useRef<Promise<void> | null>(null);

  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      connectingRef.current = null;
    };
  }, []);

  const closeSocket = () => {
    try {
      socketRef.current?.removeAllListeners();
      socketRef.current?.disconnect();
    } catch (e) {
      // ignore
    } finally {
      socketRef.current = null;
    }
  };

  const ensureSocketConnected = async () => {
    if (socketRef.current && socketRef.current.connected) {
      return;
    }

    if (connectingRef.current) {
      return connectingRef.current;
    }

    const promise = new Promise<void>((resolve, reject) => {
      const socket = ioClient(SOCKET_URL, {
        withCredentials: true,
      });

      socketRef.current = socket;

      socket.on("connect", () => {
        resolve();
      });

      socket.on("connect_error", () => {
        dispatch(
          setTaskStatus({
            status: "error",
            message: "Connection failed",
          })
        );
        toast({
          title: "Realtime connection failed",
          description:
            "Could not connect to realtime server. Retrying automatically...",
          variant: "destructive",
        });
      });

      socket.on("reconnect_failed", () => {
        dispatch(
          setTaskStatus({
            status: "error",
            message: "Reconnect failed",
          })
        );
        closeSocket();
        reject(new Error("Realtime reconnect failed"));
      });

      socket.on("disconnect", () => {
        dispatch(
          setTaskStatus({
            status: "error",
            message: "Connection disconnected",
          })
        );
      });

      socket.on("selenium:session_update", (payload: any) => {
        const { session_id, status, final } = payload || {};
        if (!session_id) return;

        if (status === "completed") {
          dispatch(
            setTaskStatus({
              status: "success",
              message:
                "CCA eligibility updated and PDF attached to patient documents.",
            })
          );
          toast({
            title: "CCA eligibility complete",
            description:
              "Patient status was updated and the eligibility PDF was saved.",
            variant: "default",
          });

          const pdfId = final?.pdfFileId;
          if (pdfId) {
            const filename =
              final?.pdfFilename ?? `eligibility_cca_${memberId}.pdf`;
            onPdfReady(Number(pdfId), filename);
          }
        } else if (status === "error") {
          const msg =
            payload?.message ||
            final?.error ||
            "CCA eligibility session failed.";
          dispatch(
            setTaskStatus({
              status: "error",
              message: msg,
            })
          );
          toast({
            title: "CCA selenium error",
            description: msg,
            variant: "destructive",
          });

          try {
            closeSocket();
          } catch (e) {}
        }

        queryClient.invalidateQueries({ queryKey: QK_PATIENTS_BASE });
      });

      socket.on("selenium:session_error", (payload: any) => {
        const msg = payload?.message || "Selenium session error";

        dispatch(
          setTaskStatus({
            status: "error",
            message: msg,
          })
        );

        toast({
          title: "Selenium session error",
          description: msg,
          variant: "destructive",
        });

        try {
          closeSocket();
        } catch (e) {}
      });

      const initialConnectTimeout = setTimeout(() => {
        if (!socket.connected) {
          closeSocket();
          reject(new Error("Realtime initial connection timeout"));
        }
      }, 8000);

      socket.once("connect", () => {
        clearTimeout(initialConnectTimeout);
      });
    });

    connectingRef.current = promise;

    try {
      await promise;
    } finally {
      connectingRef.current = null;
    }
  };

  const startCCAEligibility = async () => {
    if (!dateOfBirth) {
      toast({
        title: "Missing fields",
        description: "Date of Birth is required for CCA eligibility.",
        variant: "destructive",
      });
      return;
    }

    if (!memberId && !firstName && !lastName) {
      toast({
        title: "Missing fields",
        description:
          "Member ID, First Name, or Last Name is required for CCA eligibility.",
        variant: "destructive",
      });
      return;
    }

    const formattedDob = dateOfBirth ? formatLocalDate(dateOfBirth) : "";

    const payload = {
      memberId: memberId || "",
      dateOfBirth: formattedDob,
      firstName: firstName || "",
      lastName: lastName || "",
      insuranceSiteKey: "CCA",
    };

    try {
      setIsStarting(true);

      dispatch(
        setTaskStatus({
          status: "pending",
          message: "Opening realtime channel for CCA eligibility...",
        })
      );
      await ensureSocketConnected();

      const socket = socketRef.current;
      if (!socket || !socket.connected) {
        throw new Error("Socket connection failed");
      }

      const socketId = socket.id;

      dispatch(
        setTaskStatus({
          status: "pending",
          message: "Starting CCA eligibility check via selenium...",
        })
      );

      const response = await apiRequest(
        "POST",
        "/api/insurance-status-cca/cca-eligibility",
        {
          data: JSON.stringify(payload),
          socketId,
        }
      );

      let result: any = null;
      let backendError: string | null = null;

      try {
        result = await response.clone().json();
        backendError =
          result?.error || result?.message || result?.detail || null;
      } catch {
        try {
          const text = await response.clone().text();
          backendError = text?.trim() || null;
        } catch {
          backendError = null;
        }
      }

      if (!response.ok) {
        throw new Error(
          backendError ||
            `CCA selenium start failed (status ${response.status})`
        );
      }

      if (result?.error) {
        throw new Error(result.error);
      }

      if (result.status === "started" && result.session_id) {
        dispatch(
          setTaskStatus({
            status: "pending",
            message:
              "CCA eligibility job started. Waiting for result...",
          })
        );
      } else {
        dispatch(
          setTaskStatus({
            status: "success",
            message: "CCA eligibility completed.",
          })
        );
      }
    } catch (err: any) {
      console.error("startCCAEligibility error:", err);
      dispatch(
        setTaskStatus({
          status: "error",
          message: err?.message || "Failed to start CCA eligibility",
        })
      );
      toast({
        title: "CCA selenium error",
        description: err?.message || "Failed to start CCA eligibility",
        variant: "destructive",
      });
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <Button
      className="w-full"
      disabled={isCCAFormIncomplete || isStarting}
      onClick={startCCAEligibility}
    >
      {isStarting ? (
        <>
          <LoaderCircleIcon className="h-4 w-4 mr-2 animate-spin" />
          Processing...
        </>
      ) : (
        <>
          <CheckCircle className="h-4 w-4 mr-2" />
          CCA
        </>
      )}
    </Button>
  );
}
