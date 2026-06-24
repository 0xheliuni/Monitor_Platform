-- 添加 validation_failed 状态到 check_history.status 枚举约束
-- 用于区分 API 请求成功但验证失败的情况

-- 删除旧的约束
ALTER TABLE public.check_history DROP CONSTRAINT IF EXISTS check_status_valid;

-- 添加新的约束,包含 validation_failed
ALTER TABLE public.check_history
ADD CONSTRAINT check_status_valid
CHECK (status IN ('operational', 'degraded', 'failed', 'validation_failed'));

-- 更新注释
COMMENT ON COLUMN public.check_history.status IS '状态: operational, degraded, failed, validation_failed';
