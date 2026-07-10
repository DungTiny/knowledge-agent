import { z } from 'zod'

const bodySchema = z.object({
  name: z.string().min(1).max(100),
  email: z.email(),
  password: z.string().min(8).max(128),
  role: z.enum(['user', 'admin']).default('user'),
})

export default defineEventHandler(async (event) => {
  const requestLog = useLogger(event)
  const { user: currentUser } = await requireAdmin(event)
  const body = await readValidatedBody(event, bodySchema.parse)

  requestLog.set({ adminUserId: currentUser.id, newUserEmail: body.email, role: body.role })

  const auth = serverAuth(event)
  try {
    const result = await auth.api.createUser({
      body: {
        email: body.email,
        password: body.password,
        name: body.name,
        role: body.role,
      },
    })
    return { user: result.user }
  } catch (error: unknown) {
    const code = (error as { body?: { code?: string } })?.body?.code
    if (code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') {
      throw createError({ statusCode: 409, message: 'Email already exists', data: { why: 'A user with this email address already exists', fix: 'Use a different email address' } })
    }
    throw error
  }
})
