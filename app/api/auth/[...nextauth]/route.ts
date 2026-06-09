import NextAuth from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'

const handler = NextAuth({
  providers: [
    CredentialsProvider({
      name: 'Credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Mot de passe', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null

        const users = [
          {
            id: '1',
            email: process.env.AUTH_USER1_EMAIL ?? '',
            password: process.env.AUTH_USER1_PASSWORD ?? '',
            name: process.env.AUTH_USER1_NAME ?? 'Admin',
          },
          {
            id: '2',
            email: process.env.AUTH_USER2_EMAIL ?? '',
            password: process.env.AUTH_USER2_PASSWORD ?? '',
            name: process.env.AUTH_USER2_NAME ?? 'Client',
          },
        ]

        const user = users.find(
          (u) =>
            u.email &&
            u.password &&
            u.email.toLowerCase() === credentials.email.toLowerCase() &&
            u.password === credentials.password
        )

        if (!user) return null
        return { id: user.id, email: user.email, name: user.name }
      },
    }),
  ],
  session: { strategy: 'jwt' },
  pages: { signIn: '/login' },
  secret: process.env.NEXTAUTH_SECRET,
})

export { handler as GET, handler as POST }
