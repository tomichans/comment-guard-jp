import { signIn } from "@/app/auth/actions";
import { AuthForm } from "@/app/auth/auth-form";

export default function LoginPage() {
  return <AuthForm mode="login" action={signIn} />;
}
