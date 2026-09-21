"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { z } from "zod";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { api, apiErrorMessage } from "@/lib/axios";
import { useAuth } from "@/providers/AuthProvider";
import { Logo } from "@/components/shared/Logo";

const loginSchema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export function LoginForm() {
  const router = useRouter();
  const { admin, login } = useAuth();
  const [showPassword, setShowPassword] = useState(false);
  const [isPending, setIsPending] = useState(false);

  useEffect(() => {
    if (admin) router.replace("/dashboard");
  }, [admin, router]);

  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  /*
   * Signing in with a code instead of a password.
   *
   * Kept beside the password form rather than replacing it. Mail is a moving
   * part this portal did not have until now, and a sign-in method that depends
   * on a working SMTP host should never be the only way in.
   *
   * Its own state rather than another field on the form above: the two are
   * validated differently and half of this one is a second step, and bending
   * one schema around both would make each harder to read than either.
   */
  const [mode, setMode] = useState<"password" | "code">("password");
  const [codeEmail, setCodeEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [sending, setSending] = useState(false);

  const askForCode = async () => {
    if (!codeEmail.trim()) {
      toast.error("Enter your email address first");
      return;
    }
    setSending(true);
    try {
      await api.post("/auth/request-code", { email: codeEmail.trim() });
      setCodeSent(true);
      /*
       * Worded to match what the server will admit to. It answers the same way
       * for an address that has no account, so promising "we have sent you a
       * code" would be a claim the portal cannot actually make.
       */
      toast.success("If that address has an account, a code is on its way");
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not send a code"));
    } finally {
      setSending(false);
    }
  };

  const submitCode = async () => {
    setSending(true);
    try {
      const { data } = await api.post("/auth/code-login", {
        email: codeEmail.trim(),
        code: code.trim(),
      });
      login(data.data.accessToken, data.data.refreshToken, data.data.admin);
      router.replace("/dashboard");
    } catch (error) {
      toast.error(apiErrorMessage(error, "That code did not work"));
    } finally {
      setSending(false);
    }
  };

  const onSubmit = async (values: LoginFormValues) => {
    setIsPending(true);
    try {
      const { data } = await api.post("/auth/login", values);
      login(data.data.accessToken, data.data.refreshToken, data.data.admin);
      router.replace("/dashboard");
    } catch (error) {
      toast.error(apiErrorMessage(error, "Could not sign you in"));
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      {/* Background gradient */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-primary/5 blur-3xl" />
        <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
        className="relative w-full max-w-md"
      >
        <Card className="border-border/50 shadow-2xl">
          <CardHeader className="space-y-4 pb-6 text-center">
            <motion.div
              initial={{ scale: 0.8, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1, duration: 0.3 }}
              className="mx-auto flex items-center justify-center"
            >
              <Logo width={190} />
            </motion.div>
            <div>
              <CardTitle className="text-2xl font-bold">Root Sales CRM</CardTitle>
              <CardDescription className="mt-1">
                Sign in to reach every system from one place
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent>
            {mode === "password" && (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="email"
                  autoComplete="email"
                  autoFocus
                  {...register("email")}
                  className={errors.email ? "border-destructive" : ""}
                />
                {errors.email && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-xs text-destructive"
                  >
                    {errors.email.message}
                  </motion.p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter your password"
                    autoComplete="current-password"
                    {...register("password")}
                    className={errors.password ? "border-destructive pr-10" : "pr-10"}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.password && (
                  <motion.p
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-xs text-destructive"
                  >
                    {errors.password.message}
                  </motion.p>
                )}
              </div>

              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Signing in...
                  </>
                ) : (
                  "Sign In"
                )}
              </Button>
            </form>
            )}

            {mode === "code" && (
              <div className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="code-email">Email Address</Label>
                  <Input
                    id="code-email"
                    type="email"
                    placeholder="email"
                    autoComplete="email"
                    autoFocus
                    value={codeEmail}
                    disabled={codeSent}
                    onChange={(e) => setCodeEmail(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !codeSent) void askForCode(); }}
                  />
                </div>

                {codeSent && (
                  <div className="space-y-2">
                    <Label htmlFor="code">Six-digit code</Label>
                    <Input
                      id="code"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      placeholder="000000"
                      maxLength={6}
                      autoFocus
                      value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                      onKeyDown={(e) => { if (e.key === "Enter" && code.length === 6) void submitCode(); }}
                      className="text-center text-lg tracking-[0.4em]"
                    />
                    <p className="text-xs text-muted-foreground">
                      Sent to {codeEmail}. It works once and expires in ten minutes.
                    </p>
                  </div>
                )}

                <Button
                  type="button"
                  className="w-full"
                  disabled={sending || (codeSent && code.length !== 6)}
                  onClick={() => (codeSent ? void submitCode() : void askForCode())}
                >
                  {sending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {codeSent ? "Signing in..." : "Sending..."}
                    </>
                  ) : codeSent ? (
                    "Sign In"
                  ) : (
                    "Email me a code"
                  )}
                </Button>

                {/* A code that never arrived is the ordinary failure here, so
                    the way back is on the screen rather than needing a reload. */}
                {codeSent && (
                  <button
                    type="button"
                    onClick={() => { setCodeSent(false); setCode(""); }}
                    className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
                  >
                    Use a different address, or send another code
                  </button>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                setMode((m) => (m === "password" ? "code" : "password"));
                setCodeSent(false);
                setCode("");
              }}
              className="mt-5 flex w-full items-center justify-center gap-1.5 text-xs text-primary hover:underline"
            >
              <Mail className="h-3.5 w-3.5" />
              {mode === "password" ? "Sign in with an emailed code instead" : "Sign in with a password instead"}
            </button>

            <p className="mt-6 text-center text-xs text-muted-foreground">
              Every sign-in and CRM launch from this portal is recorded.
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
