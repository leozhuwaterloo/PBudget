import AuthForm from "@/components/AuthForm";
import { wechatEnabled } from "@/lib/wechat";

export default function SignupPage() {
  return <AuthForm mode="signup" wechatEnabled={wechatEnabled} />;
}
