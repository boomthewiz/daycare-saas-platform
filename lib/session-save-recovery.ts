/** The browser stores only an opaque operation UUID, scoped to the actor and organization. */
export const recoveryKey=(organization:string,user:string)=>`rejoyce:session-save:${organization}:${user}`
export const validOperation=(value:string|null):value is string=>!!value&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
