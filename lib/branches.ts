export type Branch = { id: string; name: string; active: boolean }
export function branchStorageKey(userId: string, organizationId: string) {
  return `rejoyce:branch:${userId}:${organizationId}`
}
export function validBranchSelection(id: string | null, branches: Branch[]) {
  return branches.some(branch => branch.id === id && branch.active) ? id! : ""
}
export function initialClientBranches(selected: string, branches: Branch[]) {
  const id = validBranchSelection(selected, branches)
  return id ? [id] : []
}
