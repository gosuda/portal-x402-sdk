import { BaseError, type BaseErrorParameters } from './base'

/** Options for {@link IdentityLookupError}. */
export type IdentityLookupErrorArgs = {
  /** ERC-8004 numeric agent id, if the lookup was by id. */
  agentId?: bigint
  /** Wallet address, if the lookup was by address. */
  address?: `0x${string}`
  cause?: BaseErrorParameters['cause']
  metaMessages?: BaseErrorParameters['metaMessages']
}

/** Thrown when an ERC-8004 Identity Registry read fails. */
export class IdentityLookupError extends BaseError {
  override readonly name = 'IdentityLookupError' as const
  readonly agentId?: bigint
  readonly address?: `0x${string}`

  constructor(args: IdentityLookupErrorArgs) {
    const target =
      args.agentId !== undefined
        ? `agentId ${args.agentId}`
        : args.address !== undefined
          ? `address ${args.address}`
          : 'unknown target'
    super(`Identity lookup failed for ${target}`, {
      cause: args.cause,
      metaMessages: args.metaMessages,
    })
    if (args.agentId !== undefined) this.agentId = args.agentId
    if (args.address !== undefined) this.address = args.address
  }
}

/** Steps in the `relay-register` CLI pipeline where registration can fail. */
export type RegistrationStep = 'ipfs' | 'registry' | 'receipt'

/** Options for {@link RegistrationError}. */
export type RegistrationErrorArgs = {
  /** Which pipeline step failed. */
  step: RegistrationStep
  cause?: BaseErrorParameters['cause']
  metaMessages?: BaseErrorParameters['metaMessages']
}

/** Thrown when the relay registration pipeline fails at one of its steps. */
export class RegistrationError extends BaseError {
  override readonly name = 'RegistrationError' as const
  readonly step: RegistrationStep

  constructor(args: RegistrationErrorArgs) {
    super(`Registration failed at step: ${args.step}`, {
      cause: args.cause,
      metaMessages: args.metaMessages,
    })
    this.step = args.step
  }
}
