import AuthForm from "@/components/AuthForm";
import { wechatEnabled } from "@/lib/wechat";

export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  const initialError = searchParams.error === "wechat" ? "auth.wechatError" : "";
  return <AuthForm mode="login" wechatEnabled={wechatEnabled} initialError={initialError} />;
}
