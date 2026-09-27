import type { components } from './schema'

type S = components['schemas']

export type ScanResult = S['ScanResult']
export type ScanRequest = S['ScanRequest']
export type CheckResult = S['CheckResult']
export type CheckName = S['CheckName']
export type CheckStatus = S['CheckStatus']
export type AttackPath = S['AttackPath']
export type Exposure = S['Exposure']
export type Grade = S['Grade']
export type Severity = S['Severity']
export type Finding = S['Finding']
export type Remediation = S['Remediation']
export type Narrative = S['Narrative']
export type DemoDomain = S['DemoDomain']
export type Health = S['HealthResponse']
