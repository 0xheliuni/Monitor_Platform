"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

import { requireAdminUser } from "@/lib/admin/auth"
import { optionalString, requiredString, withMessage } from "@/lib/admin/forms"
import { createGroup, updateGroup, deleteGroup } from "@/lib/db/groups"

function getPayload(formData: FormData) {
  return {
    group_name: requiredString(formData, "group_name", "分组名称"),
    website_url: optionalString(formData, "website_url"),
    tags: formData.get("tags")?.toString().trim() || "",
  }
}

export async function createGroupAction(formData: FormData) {
  await requireAdminUser()

  try {
    await createGroup(getPayload(formData))
  } catch (error) {
    const message = error instanceof Error ? error.message : "创建分组失败"
    redirect(withMessage("/admin/groups/new", "error", message))
  }

  revalidatePath("/admin")
  revalidatePath("/admin/groups")
  redirect(withMessage("/admin/groups", "success", "分组已创建"))
}

export async function updateGroupAction(formData: FormData) {
  await requireAdminUser()

  const id = requiredString(formData, "id", "分组 ID")

  try {
    await updateGroup(id, getPayload(formData))
  } catch (error) {
    const message = error instanceof Error ? error.message : "更新分组失败"
    redirect(withMessage(`/admin/groups/${id}`, "error", message))
  }

  revalidatePath("/admin")
  revalidatePath("/admin/groups")
  revalidatePath(`/admin/groups/${id}`)
  redirect(withMessage(`/admin/groups/${id}`, "success", "分组已更新"))
}

export async function deleteGroupAction(formData: FormData) {
  await requireAdminUser()

  const id = requiredString(formData, "id", "分组 ID")

  try {
    await deleteGroup(id)
  } catch (error) {
    const message = error instanceof Error ? error.message : "删除分组失败"
    redirect(withMessage(`/admin/groups/${id}`, "error", message))
  }

  revalidatePath("/admin")
  revalidatePath("/admin/groups")
  redirect(withMessage("/admin/groups", "success", "分组已删除"))
}
