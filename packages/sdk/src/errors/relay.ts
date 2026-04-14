import { BaseError, type BaseErrorParameters } from './base'

/** Options for {@link RelayDiscoveryError}. */
export type RelayDiscoveryErrorArgs = {
  /** The `/discovery` bootstrap URL that failed. */
  bootstrapUrl: string
  cause?: BaseErrorParameters['cause']
  metaMessages?: BaseErrorParameters['metaMessages']
}

/**
 * Thrown when the portal-tunnel `/discovery` endpoint is unreachable,
 * returns non-JSON, or fails schema validation.
 *
 * @example
 * throw new RelayDiscoveryError({ bootstrapUrl: 'https://relay.example/discovery' })
 */
export class RelayDiscoveryError extends BaseError {
  override readonly name = 'RelayDiscoveryError' as const
  readonly bootstrapUrl: string

  constructor(args: RelayDiscoveryErrorArgs) {
    super(`Relay discovery failed at ${args.bootstrapUrl}`, {
      cause: args.cause,
      metaMessages: args.metaMessages,
    })
    this.bootstrapUrl = args.bootstrapUrl
  }
}

/** Reasons `verifyPortalHost` can reject a relay's advertised host. */
export type RelayVerifyReason =
  | 'dnssec-missing'
  | 'ens-mismatch'
  | 'erc8004-missing'
  | 'ensip25-mismatch'

/** Options for {@link RelayVerificationError}. */
export type RelayVerificationErrorArgs = {
  /** The portal host under verification. */
  host: string
  /** Which cross-check failed. */
  reason: RelayVerifyReason
  cause?: BaseErrorParameters['cause']
  metaMessages?: BaseErrorParameters['metaMessages']
}

/**
 * Thrown when `verifyPortalHost` fails any of the DNSSEC / ENS /
 * ERC-8004 / ENSIP-25 cross-checks for a relay's advertised host.
 *
 * @example
 * throw new RelayVerificationError({ host: 'relay.eth', reason: 'ensip25-mismatch' })
 */
export class RelayVerificationError extends BaseError {
  override readonly name = 'RelayVerificationError' as const
  readonly host: string
  readonly reason: RelayVerifyReason

  constructor(args: RelayVerificationErrorArgs) {
    super(`Relay verification failed for ${args.host}: ${args.reason}`, {
      cause: args.cause,
      metaMessages: args.metaMessages,
    })
    this.host = args.host
    this.reason = args.reason
  }
}
