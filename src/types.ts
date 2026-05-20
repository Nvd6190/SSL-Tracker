export type RenewalStatus = 'Active' | 'Expiring Soon' | 'Urgent' | 'Expired / Critical';
export type CertType = 'Single Domain' | 'Wildcard';

export interface CertificateRecord {
  id: string;
  commonName: string;
  issuedTo: string;
  issuer: string;
  owner: string;
  contact: string;
  customerPocName: string;
  customerPocEmail: string;
  customerPocPhone: string;
  expiresOn: string;
  validFrom: string | null;
  renewedOn: string | null;
  autoRenew: boolean;
  certType: CertType;
  sanList: string[];
  tags: string[];
  notes: string;
  scanError?: string;
}

export interface ScanResult {
  hostname: string;
  commonName?: string;
  issuer?: string;
  validFrom?: string | null;
  validTo?: string | null;
  certType?: string;
  sanList?: string[];
  serialNumber?: string;
  fingerprint?: string;
  error?: string | null;
}