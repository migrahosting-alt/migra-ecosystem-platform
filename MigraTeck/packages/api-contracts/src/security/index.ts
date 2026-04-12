export interface SecurityActivityItem {
  id: string;
  type: string;
  severity: string;
  createdAt: string;
  ip: string | null;
  userAgent: string | null;
  country: string | null;
  riskScore: number | null;
  metadata: Record<string, unknown> | null;
}

export interface SecurityActivityResponseData {
  events: SecurityActivityItem[];
  nextCursor: string | null;
}