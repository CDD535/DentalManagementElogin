import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { CheckCircle, Torus } from "lucide-react";
import { CheckedState } from "@radix-ui/react-checkbox";
import LoadingScreen from "@/components/ui/LoadingScreen";
import { useLocation } from "wouter";
import {
  LoginFormValues,
  loginSchema,
} from "@repo/db/types";

export default function AuthPage() {
  const { isLoading, user, loginMutation } = useAuth();
  const [, navigate] = useLocation();

  const loginForm = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      username: "",
      password: "",
      rememberMe: false,
    },
  });

  const onLoginSubmit = (data: LoginFormValues) => {
    loginMutation.mutate({ username: data.username, password: data.password });
  };

  useEffect(() => {
    if (user) {
      navigate("/insurance-status");
    }
  }, [user, navigate]);

  if (isLoading) {
    return <LoadingScreen />;
  }

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center">
      <div className="w-full max-w-4xl grid grid-cols-1 md:grid-cols-2 shadow-lg rounded-lg overflow-hidden">
        {/* Auth Forms */}
        <Card className="p-6 bg-white">
          <div className="mb-10 text-center">
            <h1 className="text-3xl font-medium text-primary mb-2">
              My Dental Office Management
            </h1>
            <p className="text-gray-600">
              Comprehensive Practice Management System
            </p>
          </div>

          <Form {...loginForm}>
            <form
              onSubmit={loginForm.handleSubmit(onLoginSubmit)}
              className="space-y-4"
            >
              <FormField
                control={loginForm.control}
                name="username"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Username</FormLabel>
                    <FormControl>
                      <Input placeholder="Enter your username" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={loginForm.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input
                        placeholder="••••••••"
                        type="password"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex items-center justify-between">
                <FormField
                  control={loginForm.control}
                  name="rememberMe"
                  render={({ field }) => (
                    <div className="flex items-center space-x-2">
                      <Checkbox
                        id="remember-me"
                        checked={field.value as CheckedState}
                        onCheckedChange={field.onChange}
                      />
                      <label
                        htmlFor="remember-me"
                        className="text-sm font-medium text-gray-700"
                      >
                        Remember me
                      </label>
                    </div>
                  )}
                />
              </div>

              <Button
                type="submit"
                className="w-full"
                disabled={loginMutation.isPending}
              >
                {loginMutation.isPending ? "Signing in..." : "Sign in"}
              </Button>
            </form>
          </Form>
        </Card>

        {/* Hero Section */}
        <div className="md:block bg-primary p-8 text-white flex flex-col justify-center">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-white bg-opacity-10 rounded-full flex items-center justify-center">
              <Torus className="h-8 w-8" />
            </div>
          </div>
          <p className="mb-6 text-center text-white text-opacity-80">
            The complete solution for dental practice management. Streamline
            your patient records, appointments, and more.
          </p>
          <ul className="space-y-4">
            <li className="flex items-center">
              <CheckCircle className="h-5 w-5 mr-2 text-white text-opacity-80" />
              <span>Easily manage patient records</span>
            </li>
            <li className="flex items-center">
              <CheckCircle className="h-5 w-5 mr-2 text-white text-opacity-80" />
              <span>Track patient insurance information</span>
            </li>
            <li className="flex items-center">
              <CheckCircle className="h-5 w-5 mr-2 text-white text-opacity-80" />
              <span>Secure and compliant data storage</span>
            </li>
            <li className="flex items-center">
              <CheckCircle className="h-5 w-5 mr-2 text-white text-opacity-80" />
              <span>Simple and intuitive interface</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
