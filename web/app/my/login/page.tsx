"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion } from "framer-motion";
import { z } from "zod";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Logo } from "@/components/shared/Logo";
import { repApi, REP_ACCESS, REP_REFRESH } from "@/lib/repAxios";
import { apiErrorMessage } from "@/lib/axios";

const schema = z.object({
  email: z.string().min(1, "Email is required").email("Enter a valid email"),
  password: z.string().min(1, "Password is required"),
});
type Values = z.infer<typeof schema>;

export default function RepLoginPage() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  // Only asked for when the same email exists in more than one CRM, which is
  // rare enough that showing an org picker to everyone would be noise.
  const [orgChoices, setOrgChoices] = useState<{ code: string; name: string }[] | null>(null);

  useEffect(() => {
    if (localStorage.getItem(REP_ACCESS)) router.replace("/my");
  }, [router]);

  const { register, handleSubmit, formState: { errors } } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const submit = async (values: Values, org?: string) => {
    setPending(true);
    try {
      const { data } = await repApi.post("/rep/login", { ...values, org });
      localStorage.setItem(REP_ACCESS, data.data.accessToken);
      localStorage.setItem(REP_REFRESH, data.data.refreshToken);
      router.replace("/my");
    } catch (error) {
      const res = (error as { response?: { status?: number; data?: { errors?: { orgs?: { code: string; name: string }[] } } } }).response;
      if (res?.status === 409 && res.data?.errors?.orgs) {
        setOrgChoices(res.data.errors.orgs);
        toast.info("Choose which organisation to sign in to");
        return;
      }
      toast.error(apiErrorMessage(error, "Could not sign you in"));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
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
            <div className="mx-auto flex items-center justify-center">
              <Logo width={170} />
            </div>
            <div>
              <CardTitle className="text-2xl font-bold">My Daily Tracker</CardTitle>
              <CardDescription className="mt-1">
                Sign in with the same email and password you use for your CRM.
              </CardDescription>
            </div>
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit((v) => submit(v))} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input id="email" type="email" autoComplete="email" autoFocus {...register("email")}
                  className={errors.email ? "border-destructive" : ""} />
                {errors.email && <p className="text-xs text-destructive">{errors.email.message}</p>}
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <div className="relative">
                  <Input id="password" type={showPassword ? "text" : "password"}
                    autoComplete="current-password" {...register("password")}
                    className={errors.password ? "border-destructive pr-10" : "pr-10"} />
                  <button type="button" onClick={() => setShowPassword((v) => !v)} tabIndex={-1}
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.password && <p className="text-xs text-destructive">{errors.password.message}</p>}
              </div>

              {orgChoices ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    This account exists in more than one organisation. Which one?
                  </p>
                  <div className="grid gap-2">
                    {orgChoices.map((o) => (
                      <Button key={o.code} type="button" variant="secondary" disabled={pending}
                        onClick={handleSubmit((v) => submit(v, o.code))}>
                        {o.name}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : (
                <Button type="submit" className="w-full" disabled={pending}>
                  {pending ? (<><Loader2 className="h-4 w-4 animate-spin" />Signing in…</>) : "Sign In"}
                </Button>
              )}
            </form>

            <p className="mt-6 text-center text-xs text-muted-foreground">
              Your CRM password is checked, never changed or stored here.
            </p>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
