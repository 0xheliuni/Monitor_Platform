CREATE TABLE IF NOT EXISTS public.group_info (
    id uuid NOT NULL DEFAULT gen_random_uuid(),
    group_name text NOT NULL,
    website_url text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT group_info_pkey PRIMARY KEY (id),
    CONSTRAINT group_info_group_name_key UNIQUE (group_name)
);

DROP TRIGGER IF EXISTS update_group_info_updated_at ON public.group_info;
CREATE TRIGGER update_group_info_updated_at
BEFORE UPDATE ON public.group_info
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.group_info IS '分组信息表 - 存储分组的额外信息';
COMMENT ON COLUMN public.group_info.group_name IS '分组名称 - 关联 check_configs.group_name';
COMMENT ON COLUMN public.group_info.website_url IS '网站地址';
