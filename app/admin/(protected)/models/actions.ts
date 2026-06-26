"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { requireAdminUser } from "@/lib/admin/auth"
import { optionalString, parseProviderType, requiredString, withMessage } from "@/lib/admin/forms"
import { createModel, updateModel, deleteModel, listModels, countConfigsByModel } from "@/lib/db/models"
import { getTemplate } from "@/lib/db/templates"

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

async function parseModelPayload(formData: FormData) {
  const type = parseProviderType(requiredString(formData, "type", "Provider 类型"))
  const templateId = optionalString(formData, "template_id")

  if (templateId) {
    const template = await getTemplate(templateId)

    if (!template) {
      throw new Error("所选模板不存在")
    }

    if (template.type !== type) {
      throw new Error("模板类型和模型类型不一致")
    }
  }

  return {
    type,
    model: requiredString(formData, "model", "模型名称"),
    template_id: templateId,
  }
}

export async function createModelAction(formData: FormData) {
  await requireAdminUser()

  try {
    const payload = await parseModelPayload(formData)
    await createModel(payload)
  } catch (error) {
    const message = getActionErrorMessage(error, "创建模型失败")
    redirect(withMessage("/admin/models/new", "error", message))
  }

  revalidatePath("/admin")
  revalidatePath("/admin/models")
  revalidatePath("/admin/configs")
  revalidatePath("/admin/templates")
  redirect(withMessage("/admin/models", "success", "模型已创建"))
}

export async function updateModelAction(formData: FormData) {
  await requireAdminUser()

  const id = requiredString(formData, "id", "模型 ID")

  try {
    const payload = await parseModelPayload(formData)
    await updateModel(id, payload)
  } catch (error) {
    const message = getActionErrorMessage(error, "更新模型失败")
    redirect(withMessage(`/admin/models/${id}`, "error", message))
  }

  revalidatePath("/admin")
  revalidatePath("/admin/models")
  revalidatePath("/admin/configs")
  revalidatePath("/admin/templates")
  redirect(withMessage(`/admin/models/${id}`, "success", "模型已更新"))
}

export async function deleteModelAction(formData: FormData) {
  await requireAdminUser()

  const id = requiredString(formData, "id", "模型 ID")

  try {
    const count = await countConfigsByModel(id)

    if (count > 0) {
      throw new Error("该模型仍被配置引用，不能删除")
    }

    await deleteModel(id)
  } catch (error) {
    const message = getActionErrorMessage(error, "删除模型失败")
    redirect(withMessage(`/admin/models/${id}`, "error", message))
  }

  revalidatePath("/admin")
  revalidatePath("/admin/models")
  revalidatePath("/admin/configs")
  revalidatePath("/admin/templates")
  redirect(withMessage("/admin/models", "success", "模型已删除"))
}

export async function cleanupUnusedModelsAction() {
  await requireAdminUser()

  let successMessage = ""

  try {
    const allModels = await listModels()
    const unusedModelIds: string[] = []

    for (const m of allModels) {
      const count = await countConfigsByModel(m.id)
      if (count === 0) unusedModelIds.push(m.id)
    }

    if (unusedModelIds.length === 0) {
      successMessage = "没有可清理的未引用模型"
    } else {
      for (const id of unusedModelIds) {
        await deleteModel(id)
      }
      successMessage = `已清理 ${unusedModelIds.length} 条未引用模型`
    }
  } catch (error) {
    const message = getActionErrorMessage(error, "清理未引用模型失败")
    redirect(withMessage("/admin/models", "error", message))
  }

  revalidatePath("/admin")
  revalidatePath("/admin/models")
  revalidatePath("/admin/configs")
  revalidatePath("/admin/templates")
  redirect(withMessage("/admin/models", "success", successMessage))
}
