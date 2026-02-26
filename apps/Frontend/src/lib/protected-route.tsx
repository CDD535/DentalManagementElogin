import AppLayout from "@/components/layout/app-layout";
import LoadingScreen from "@/components/ui/LoadingScreen";
import { useAuth } from "@/hooks/use-auth";
import { Suspense } from "react";
import { Redirect, Route } from "wouter";

type ComponentLike = React.ComponentType;

export function ProtectedRoute({
  path,
  component: Component,
  adminOnly,
}: {
  path: string;
  component: ComponentLike;
  adminOnly?: boolean;
}) {
  const { user, isLoading } = useAuth();

  return (
    <Route path={path}>
      {isLoading ? (
        <AppLayout>
          <LoadingScreen />
        </AppLayout>
      ) : !user ? (
        <Redirect to="/auth" />
      ) : adminOnly &&
        user.role?.toUpperCase() !== "ADMIN" &&
        user.username?.toLowerCase() !== "admin" ? (
        <Redirect to="/dashboard" />
      ) : (
        <AppLayout>
          <Suspense fallback={<LoadingScreen />}>
            <Component />
          </Suspense>
        </AppLayout>
      )}
    </Route>
  );
}
