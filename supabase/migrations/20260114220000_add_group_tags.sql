ALTER TABLE public.group_info
  ADD COLUMN IF NOT EXISTS tags text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.group_info.tags IS '分组 Tag 列表，英文逗号分隔字符串';
