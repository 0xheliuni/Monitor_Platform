"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  ActivityIcon,
  BellIcon,
  FolderTreeIcon,
  GaugeIcon,
  HistoryIcon,
  LayoutTemplateIcon,
  Layers3Icon,
  ListChecksIcon,
  ServerCogIcon,
  SirenIcon,
  TargetIcon,
  TerminalIcon,
  WaypointsIcon,
  WebhookIcon,
} from "lucide-react"

import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"

const mainItems = [
  { title: "概览", url: "/admin", icon: GaugeIcon },
  { title: "Provider 配置", url: "/admin/configs", icon: ServerCogIcon },
  { title: "模型配置", url: "/admin/models", icon: Layers3Icon, adminOnly: true },
  { title: "请求模板", url: "/admin/templates", icon: LayoutTemplateIcon, adminOnly: true },
  { title: "分组信息", url: "/admin/groups", icon: FolderTreeIcon, adminOnly: true },
  { title: "系统通知", url: "/admin/notifications", icon: BellIcon, adminOnly: true },
  { title: "历史记录", url: "/admin/history", icon: HistoryIcon },
  { title: "运行状态", url: "/admin/system", icon: WaypointsIcon },
]

const monitorItems = [
  { title: "监控目标", url: "/admin/targets", icon: TargetIcon, adminOnly: true },
  { title: "监控任务", url: "/admin/monitor-tasks", icon: ListChecksIcon, adminOnly: true },
  { title: "告警规则", url: "/admin/alerts", icon: SirenIcon, adminOnly: true },
  { title: "告警事件", url: "/admin/alert-events", icon: ActivityIcon, adminOnly: true },
  { title: "飞书 Webhook", url: "/admin/webhooks", icon: WebhookIcon, adminOnly: true },
]

export function AppSidebar({
  user,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  user: {
    name: string
    email: string
    avatar?: string | null
    role: "admin" | "member"
    groupName?: string | null
  }
}) {
  const pathname = usePathname()

  return (
    <Sidebar variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" render={<Link href="/admin" />}>
              <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                <TerminalIcon className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">监控平台后台</span>
                <span className="truncate text-xs">SQLite + Next.js</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>管理台</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems
                .filter((item) => !item.adminOnly || user.role === "admin")
                .map((item) => {
                const isActive =
                  item.url === "/admin"
                    ? pathname === item.url
                    : pathname.startsWith(item.url)
                const Icon = item.icon

                return (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton
                      isActive={isActive}
                      tooltip={item.title}
                      render={<Link href={item.url} />}
                    >
                      <Icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {monitorItems.some((item) => !item.adminOnly || user.role === "admin") ? (
          <SidebarGroup>
            <SidebarGroupLabel>newapi 监控</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {monitorItems
                  .filter((item) => !item.adminOnly || user.role === "admin")
                  .map((item) => {
                  const isActive = pathname.startsWith(item.url)
                  const Icon = item.icon

                  return (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton
                        isActive={isActive}
                        tooltip={item.title}
                        render={<Link href={item.url} />}
                      >
                        <Icon />
                        <span>{item.title}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ) : null}
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
