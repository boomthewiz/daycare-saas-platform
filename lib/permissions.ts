/** Supported per-user grants. Adding a key also requires database enforcement. */
export const permissionDefinitions = [
  { key: "can_delegate_permissions", label: "May delegate permissions", description: "With Manage users, allows editing other team members’ permission grants. Only owners and administrators can change this setting or billing grants.", grantAuthority: "owner_admin" },
  { key: "can_manage_users", label: "Manage users", description: "Invite, edit, and deactivate organization accounts. Only owners and administrators can manage administrators.", grantAuthority: "delegate" },
  { key: "can_manage_clients", label: "Manage clients", description: "Create and edit client profiles, targets, and behaviors.", grantAuthority: "delegate" },
  { key: "can_manage_sessions", label: "Manage sessions", description: "Create, prepare, edit, and assign sessions.", grantAuthority: "delegate" },
  { key: "can_review_sessions", label: "Review session notes", description: "Review submitted documentation and return or approve notes.", grantAuthority: "delegate" },
  { key: "can_view_reports", label: "View reports", description: "Access organization reporting and analytics.", grantAuthority: "delegate" },
  { key: "can_manage_billing", label: "Manage billing", description: "Access subscription and billing administration.", grantAuthority: "owner_admin" },
] as const

export type PermissionKey = (typeof permissionDefinitions)[number]["key"]
export type PermissionGrants = Record<PermissionKey, boolean>
export const permissionKeys = permissionDefinitions.map(({ key }) => key)
export const permissionColumns = permissionKeys.join(",")

/** Fresh, default-deny values; unknown fields never become persisted grants. */
export function normalizePermissions(value: unknown): PermissionGrants {
  const source = value && typeof value === "object"
    ? value as Record<string, unknown> : {}
  return Object.fromEntries(permissionKeys.map(key => [
    key, Object.prototype.hasOwnProperty.call(source, key) && source[key] === true,
  ])) as PermissionGrants
}

export function emptyPermissions(): PermissionGrants {
  return normalizePermissions(null)
}

export type PermissionEditor = {
  role: string | null
  canManageUsers: boolean
  canDelegatePermissions: boolean
  isSelf: boolean
  targetIsOwner: boolean
  targetIsAdmin?: boolean
}

/** UI affordances only. RLS and database triggers authorize every actual write. */
export function canEditPermission(editor: PermissionEditor, key: string): boolean {
  const definition = permissionDefinitions.find(permission => permission.key === key)
  if (!definition || editor.isSelf || editor.targetIsOwner || !editor.canManageUsers) return false
  if (editor.role === "owner" || editor.role === "admin") return true
  if (editor.targetIsAdmin) return false
  return editor.canDelegatePermissions && definition.grantAuthority === "delegate"
}
