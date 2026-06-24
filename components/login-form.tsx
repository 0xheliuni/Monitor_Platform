import { KeyRoundIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"

export function LoginForm({
  className,
  errorMessage,
  authEnvReady,
  nextPath,
  ...props
}: React.ComponentProps<"div"> & {
  errorMessage?: string
  authEnvReady: boolean
  nextPath: string
}) {
  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader className="text-center">
          <CardTitle className="text-xl">登录后台</CardTitle>
          <CardDescription>
            输入管理员密钥进入控制台。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form method="post" action="/auth/sign-in/password">
            <input type="hidden" name="next" value={nextPath} />
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="admin-key">管理员密钥</FieldLabel>
                <Input
                  id="admin-key"
                  name="key"
                  type="password"
                  autoComplete="current-password"
                  required
                  disabled={!authEnvReady}
                  placeholder="请输入 ADMIN_LOGIN_KEY"
                />
                <FieldDescription>
                  密钥配置在服务端的 <code>ADMIN_LOGIN_KEY</code>，由管理员私下分发。
                </FieldDescription>
              </Field>
              <Field>
                <Button type="submit" disabled={!authEnvReady}>
                  <KeyRoundIcon className="size-4" />
                  登录
                </Button>
              </Field>
              {errorMessage ? (
                <FieldDescription className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-destructive">
                  {errorMessage}
                </FieldDescription>
              ) : null}
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
      <FieldDescription className="px-6 text-center">
        登录后会下发签名 cookie，永久有效，需要手动点退出才会失效。
      </FieldDescription>
    </div>
  )
}
