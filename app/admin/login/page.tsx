export const dynamic = "force-dynamic"

import { redirect } from "next/navigation"
import { ShieldCheckIcon } from "lucide-react"

import { Notice } from "@/components/admin/notice"
import { LoginForm } from "@/components/login-form"
import { getOptionalAppUser } from "@/lib/admin/auth"
import {
  getAdminAuthWarnings,
  hasAdminAuthEnv,
} from "@/lib/admin/session"

function resolveErrorMessage(code?: string) {
  switch (code) {
    case "invalid-key":
      return "密钥不正确，请向管理员确认 ADMIN_LOGIN_KEY 的最新值。"
    case "missing-env":
      return "服务端未配置 ADMIN_LOGIN_KEY 或 ADMIN_SESSION_SECRET，登录暂不可用。"
    default:
      return undefined
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const user = await getOptionalAppUser()

  if (user) {
    redirect("/admin")
  }

  const params = await searchParams
  const errorCode = Array.isArray(params.error) ? params.error[0] : params.error
  const nextParam = Array.isArray(params.next) ? params.next[0] : params.next
  const nextPath = nextParam && nextParam.startsWith("/") ? nextParam : "/admin"

  const authEnvReady = hasAdminAuthEnv()
  const envWarnings = getAdminAuthWarnings()

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 bg-muted p-6 md:p-10">
      <div className="flex w-full max-w-md flex-col gap-6">
        <div className="flex items-center gap-2 self-center font-medium">
          <div className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <ShieldCheckIcon className="size-4" />
          </div>
          check-cx Admin
        </div>
        {!authEnvReady ? (
          <Notice
            variant="warning"
            title="先把环境变量配好"
            description={envWarnings.join("；")}
          />
        ) : null}
        <LoginForm
          authEnvReady={authEnvReady}
          errorMessage={resolveErrorMessage(errorCode)}
          nextPath={nextPath}
        />
      </div>
    </div>
  )
}
