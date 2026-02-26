import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Users,
  Calendar,
  Settings,
  FileCheck,
  Shield,
  CreditCard,
  FolderOpen,
  Database,
  FileText,
  Cloud,
  Phone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useMemo } from "react";
import { useSidebar } from "@/components/ui/sidebar";
import { useAuth } from "@/hooks/use-auth";

export function Sidebar() {
  const [location] = useLocation();
  const { state, openMobile, setOpenMobile } = useSidebar();
  const { user } = useAuth();

  const isAdmin =
    user?.role?.toUpperCase() === "ADMIN" ||
    user?.username?.toLowerCase() === "admin";

  const navItems = useMemo(
    () => [
      {
        name: "Dashboard",
        path: "/dashboard",
        icon: <LayoutDashboard className="h-5 w-5" />,
      },
      {
        name: "Patient Connection",
        path: "/patient-connection",
        icon: <Phone className="h-5 w-5" />,
      },
      {
        name: "Appointments",
        path: "/appointments",
        icon: <Calendar className="h-5 w-5" />,
      },
      {
        name: "Patients",
        path: "/patients",
        icon: <Users className="h-5 w-5" />,
      },
      {
        name: "Eligibility/Claim Status",
        path: "/insurance-status",
        icon: <Shield className="h-5 w-5" />,
      },
      {
        name: "Claims/PreAuth",
        path: "/claims",
        icon: <FileCheck className="h-5 w-5" />,
      },
      {
        name: "Payments",
        path: "/payments",
        icon: <CreditCard className="h-5 w-5" />,
      },
      {
        name: "Documents",
        path: "/documents",
        icon: <FolderOpen className="h-5 w-5" />,
      },
      {
        name: "Reports",
        path: "/reports",
        icon: <FileText className="h-5 w-5" />,
      },
      {
        name: "Cloud storage",
        path: "/cloud-storage",
        icon: <Cloud className="h-5 w-5" />,
      },
      {
        name: "Backup Database",
        path: "/database-management",
        icon: <Database className="h-5 w-5" />,
      },
      {
        name: "Settings",
        path: "/settings",
        icon: <Settings className="h-5 w-5" />,
        adminOnly: true,
      },
    ],
    []
  );

  return (
    <div
      className={cn(
        "bg-white border-r border-gray-200 shadow-sm z-20",
        "overflow-hidden will-change-[width]",
        "transition-[width] duration-200 ease-in-out",
        openMobile
          ? "fixed top-16 left-0 h-[calc(100vh-4rem)] w-64 block md:hidden"
          : "hidden md:block",
        "md:static md:top-auto md:h-auto md:flex-shrink-0",
        state === "collapsed" ? "md:w-0 overflow-hidden" : "md:w-64"
      )}
    >
      <div className="p-2">
        <nav role="navigation" aria-label="Main">
          {navItems
            .filter((item) => !item.adminOnly || isAdmin)
            .map((item) => (
              <div key={item.path}>
                <Link to={item.path} onClick={() => setOpenMobile(false)}>
                  <div
                    className={cn(
                      "flex items-center space-x-3 p-2 rounded-md pl-3 mb-1 transition-colors cursor-pointer",
                      location === item.path
                        ? "text-primary font-medium border-l-2 border-primary"
                        : "text-gray-600 hover:bg-gray-100"
                    )}
                  >
                    {item.icon}
                    <span className="whitespace-nowrap select-none">
                      {item.name}
                    </span>
                  </div>
                </Link>
              </div>
            ))}
        </nav>
      </div>
    </div>
  );
}
