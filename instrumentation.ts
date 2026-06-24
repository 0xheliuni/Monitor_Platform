/**
 * Next.js Instrumentation Hook
 * 在服务器启动时运行数据库迁移并初始化后台轮询器
 * 修复 Docker standalone 模式下轮询器无法启动的问题
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { runMigrations } = await import('@/lib/db/migrate')
    runMigrations()
    await import('@/lib/core/poller')
  }
}
