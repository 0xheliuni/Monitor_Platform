"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { requireAdminUser } from "@/lib/admin/auth"
import { parseProviderType, requiredString, withMessage } from "@/lib/admin/forms"
import { parseOptionalJson } from "@/lib/admin/json"
import {
  createTemplate,
  updateTemplate,
  deleteTemplate,
  listTemplates,
  countModelsByTemplate,
} from "@/lib/db/templates"

function getActionErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  if (
    error &&
    typeof error === "object" &&
    "message" in error &&
    typeof error.message === "string" &&
    error.message.trim().length > 0
  ) {
    return error.message
  }

  return fallback
}

async function parseTemplatePayload(formData: FormData) {
  return {
    name: requiredString(formData, "name", "模板名称"),
    type: parseProviderType(requiredString(formData, "type", "Provider 类型")),
    request_header: parseOptionalJson(formData.get("request_header"), "请求头 JSON") as Record<string, string> | null,
    metadata: parseOptionalJson(formData.get("metadata"), "metadata JSON") as Record<string, unknown> | null,
  }
}

export async function createTemplateAction(formData: FormData) {
  await requireAdminUser()

  try {
    const payload = await parseTemplatePayload(formData)
    await createTemplate(payload)
  } catch (error) {
    const message = getActionErrorMessage(error, "创建模板失败")
    redirect(withMessage("/admin/templates/new", "error", message))
  }

  revalidatePath("/admin")
  revalidatePath("/admin/templates")
  revalidatePath("/admin/models")
  redirect(withMessage("/admin/templates", "success", "模板已创建"))
}

export async function updateTemplateAction(formData: FormData) {
  await requireAdminUser()

  const id = requiredString(formData, "id", "模板 ID")

  try {
    const payload = await parseTemplatePayload(formData)
    await updateTemplate(id, payload)
  } catch (error) {
    const message = getActionErrorMessage(error, "更新模板失败")
    redirect(withMessage(`/admin/templates/${id}`, "error", message))
  }

  revalidatePath("/admin")
  revalidatePath("/admin/templates")
  revalidatePath("/admin/models")
  redirect(withMessage(`/admin/templates/${id}`, "success", "模板已更新"))
}

export async function deleteTemplateAction(formData: FormData) {
  await requireAdminUser()

  const id = requiredString(formData, "id", "模板 ID")

  try {
    const count = await countModelsByTemplate(id)

    if (count > 0) {
      throw new Error("该模板仍被模型引用，不能删除")
    }

    await deleteTemplate(id)
  } catch (error) {
    const message = getActionErrorMessage(error, "删除模板失败")
    redirect(withMessage(`/admin/templates/${id}`, "error", message))
  }

  revalidatePath("/admin")
  revalidatePath("/admin/templates")
  revalidatePath("/admin/models")
  redirect(withMessage("/admin/templates", "success", "模板已删除"))
}

export async function cleanupUnusedTemplatesAction() {
  await requireAdminUser()

  let successMessage = ""

  try {
    const allTemplates = await listTemplates()
    const unusedTemplateIds: string[] = []

    for (const t of allTemplates) {
      const count = await countModelsByTemplate(t.id)
      if (count === 0) unusedTemplateIds.push(t.id)
    }

    if (unusedTemplateIds.length === 0) {
      successMessage = "没有可清理的未引用模板"
    } else {
      for (const id of unusedTemplateIds) {
        await deleteTemplate(id)
      }
      successMessage = `已清理 ${unusedTemplateIds.length} 条未引用模板`
    }
  } catch (error) {
    const message = getActionErrorMessage(error, "清理未引用模板失败")
    redirect(withMessage("/admin/templates", "error", message))
  }

  revalidatePath("/admin")
  revalidatePath("/admin/templates")
  revalidatePath("/admin/models")
  redirect(withMessage("/admin/templates", "success", successMessage))
}
