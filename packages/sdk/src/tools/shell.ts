import { tool } from 'ai'
import { z } from 'zod'
import type { SavoirClient } from '../client'
import { validateShellCommand } from '../shell-policy'

export interface ShellToolBudget {
  used: number
  max: number
}

export function consumeShellBudget(budget?: ShellToolBudget): string | null {
  if (!budget) return null
  if (budget.used >= budget.max) {
    return `Shell lookup budget exhausted after ${budget.max} calls. Stop searching and answer with the results already collected.`
  }
  budget.used++
  return null
}

export function createBashTool(client: SavoirClient, budget?: ShellToolBudget) {
  return tool({
    description: `Execute a bash command in the documentation sandbox.
Use standard Unix commands to explore and read files.`,
    inputSchema: z.object({
      command: z.string().describe('Bash command to execute'),
    }),
    inputExamples: [
      { input: { command: 'find docs/ -maxdepth 2 -type d' } },
      { input: { command: 'grep -rl "useAsyncData" docs/ --include="*.md" | head -5' } },
    ],
    execute: async function* ({ command }) {
      yield { status: 'loading' as const }
      const start = Date.now()
      const budgetError = consumeShellBudget(budget)

      if (budgetError) {
        yield {
          status: 'done' as const,
          success: false,
          durationMs: Date.now() - start,
          stdout: '',
          stderr: budgetError,
          exitCode: 1,
          commands: [{ command, stdout: '', stderr: budgetError, exitCode: 1, success: false }],
        }
        return
      }

      const validation = validateShellCommand(command, {
        allowedBaseDirectory: '/vercel/sandbox',
      })
      if (!validation.ok) {
        yield {
          status: 'done' as const,
          success: false,
          durationMs: Date.now() - start,
          stdout: '',
          stderr: validation.reason,
          exitCode: 1,
          commands: [{ command, stdout: '', stderr: validation.reason, exitCode: 1, success: false }],
        }
        return
      }

      const result = await client.bash(command)
      const durationMs = Date.now() - start
      const success = result.exitCode === 0

      yield {
        status: 'done' as const,
        success,
        durationMs,
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        commands: [{ command, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode, success }],
      }
    },
  })
}

export function createBashBatchTool(client: SavoirClient, budget?: ShellToolBudget) {
  return tool({
    description: `Execute multiple bash commands in the documentation sandbox in a single request.
More efficient than multiple single bash calls — use this as your primary tool.
Combine search (grep) and read (head/cat) commands in a single batch.
Maximum 10 commands per batch.`,
    inputSchema: z.object({
      commands: z.array(z.string()).min(1).max(10).describe('Array of bash commands to execute'),
    }),
    inputExamples: [
      { input: { commands: [
        'grep -rl "useAsyncData" docs/ --include="*.md" | head -5',
        'head -80 docs/nuxt/1.getting-started/1.introduction.md',
      ] } },
      { input: { commands: [
        'grep -rl "routing" docs/nuxt/ --include="*.md" | head -5',
        'grep -rl "routing" docs/nitro/ --include="*.md" | head -5',
        'head -80 docs/nuxt/1.getting-started/3.routing.md',
      ] } },
    ],
    execute: async function* ({ commands }) {
      yield { status: 'loading' as const }
      const start = Date.now()
      const budgetError = consumeShellBudget(budget)

      if (budgetError) {
        const commandResults = commands.map(command => ({ command, stdout: '', stderr: budgetError, exitCode: 1, success: false }))
        yield {
          status: 'done' as const,
          success: false,
          durationMs: Date.now() - start,
          results: commandResults.map(({ command, stdout, stderr, exitCode }) => ({ command, stdout, stderr, exitCode })),
          commands: commandResults,
        }
        return
      }

      for (const command of commands) {
        const validation = validateShellCommand(command, {
          allowedBaseDirectory: '/vercel/sandbox',
        })
        if (!validation.ok) {
          const errorResult = { command, stdout: '', stderr: validation.reason, exitCode: 1, success: false }
          yield {
            status: 'done' as const,
            success: false,
            durationMs: Date.now() - start,
            results: [{ command, stdout: '', stderr: validation.reason, exitCode: 1 }],
            commands: [errorResult],
          }
          return
        }
      }

      const apiResult = await client.bashBatch(commands)
      const durationMs = Date.now() - start

      const commandResults = apiResult.results.map(r => ({
        command: r.command,
        stdout: r.stdout,
        stderr: r.stderr,
        exitCode: r.exitCode,
        success: r.exitCode === 0,
      }))

      yield {
        status: 'done' as const,
        success: commandResults.every(r => r.success),
        durationMs,
        results: apiResult.results.map(r => ({ command: r.command, stdout: r.stdout, stderr: r.stderr, exitCode: r.exitCode })),
        commands: commandResults,
      }
    },
  })
}
