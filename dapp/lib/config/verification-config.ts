/**
 * Modular verification configuration system
 * 
 * This file defines all available verification methods and their metadata.
 * 
 * ## Adding a New Verification Method
 * 
 * 1. Add a new entry to VERIFICATION_METHODS array with:
 *    - `id`: Unique identifier (e.g., 'github', 'linkedin')
 *    - `name`: Must match the key in VerificationStatus interface from useVerification hook
 *    - `displayName`: User-friendly name shown in UI
 *    - `icon`: Icon identifier (component name from lucide-react)
 *    - `category`: Either 'identity' or 'social'
 *    - `enabled`: Set to true when ready to use, false for "coming soon"
 *    - `priority`: Display order (lower = higher priority)
 * 
 * 2. Update VerificationStatus interface in useVerification hook to include the new field
 * 
 * 3. The system will automatically:
 *    - Include it in verification status calculations
 *    - Display it in the wallet connect dropdown
 *    - Count it towards verification completion
 * 
 * Example:
 * ```typescript
 * {
 *   id: 'github',
 *   name: 'github',  // Must match VerificationStatus.github
 *   displayName: 'GitHub',
 *   icon: 'Github',
 *   category: 'social',
 *   enabled: true,
 *   priority: 5,
 * }
 * ```
 */

export interface VerificationMethodConfig {
  id: string;
  name: string;
  displayName: string;
  icon: string; // Icon name or component identifier
  category: 'identity' | 'social';
  enabled: boolean; // Whether this method is currently enabled
  priority: number; // Display priority (lower = higher priority)
}

/**
 * Configuration for all verification methods
 * Add new methods here as they become available
 */
export const VERIFICATION_METHODS: VerificationMethodConfig[] = [
  {
    id: 'telegram',
    name: 'telegram',
    displayName: 'Telegram',
    icon: 'MessageCircle',
    category: 'social',
    enabled: true,
    priority: 1,
  },
  {
    id: 'twitter',
    name: 'twitter',
    displayName: 'X (Twitter)',
    icon: 'Twitter',
    category: 'social',
    enabled: false, // Coming soon
    priority: 2,
  },
  {
    id: 'discord',
    name: 'discord',
    displayName: 'Discord',
    icon: 'MessageSquare',
    category: 'social',
    enabled: false, // Coming soon
    priority: 3,
  },
  {
    id: 'reddit',
    name: 'reddit',
    displayName: 'Reddit',
    icon: 'MessageCircle',
    category: 'social',
    enabled: false, // Coming soon
    priority: 4,
  },
  {
    id: 'kyc',
    name: 'kyc',
    displayName: 'KYC',
    icon: 'FileText',
    category: 'identity',
    enabled: false, // Coming soon
    priority: 5,
  },
  {
    id: 'did',
    name: 'did',
    displayName: 'DID',
    icon: 'Fingerprint',
    category: 'identity',
    enabled: false, // Coming soon
    priority: 6,
  },
  {
    id: 'manual_review',
    name: 'manual_review',
    displayName: 'Manual Review',
    icon: 'User',
    category: 'identity',
    enabled: false, // Coming soon
    priority: 7,
  },
];

/**
 * Get verification methods by category
 */
export function getVerificationMethodsByCategory(category: 'identity' | 'social'): VerificationMethodConfig[] {
  return VERIFICATION_METHODS.filter(method => method.category === category);
}

/**
 * Get enabled verification methods
 */
export function getEnabledVerificationMethods(): VerificationMethodConfig[] {
  return VERIFICATION_METHODS.filter(method => method.enabled);
}

/**
 * Get verification method by ID
 */
export function getVerificationMethod(id: string): VerificationMethodConfig | undefined {
  return VERIFICATION_METHODS.find(method => method.id === id || method.name === id);
}

/**
 * Map verification status to a user-friendly format
 */
export interface VerificationStatusDisplay {
  icon: 'UserCheck' | 'CheckCircle' | 'AlertCircle';
  color: string;
  bgColor: string;
  text: string;
  description: string;
  verifiedCount: number;
  totalCount: number;
}

/**
 * Calculate verification status display from actual verification data
 */
export function calculateVerificationStatus(
  verificationStatus: {
    telegram?: boolean;
    twitter?: boolean;
    discord?: boolean;
    reddit?: boolean;
    kyc?: boolean;
    did?: boolean;
    manual_review?: boolean;
  } | null
): VerificationStatusDisplay {
  if (!verificationStatus) {
    return {
      icon: 'UserCheck',
      color: 'text-gray-600',
      bgColor: 'bg-gray-100',
      text: 'Unverified',
      description: 'Identity not verified',
      verifiedCount: 0,
      totalCount: VERIFICATION_METHODS.filter(m => m.enabled).length,
    };
  }

  // Count verified methods (only enabled ones)
  const enabledMethods = VERIFICATION_METHODS.filter(m => m.enabled);
  const verifiedCount = enabledMethods.filter(method => {
    const key = method.name as keyof typeof verificationStatus;
    return verificationStatus[key] === true;
  }).length;

  const totalCount = enabledMethods.length;

  if (verifiedCount === 0) {
    return {
      icon: 'UserCheck',
      color: 'text-gray-600',
      bgColor: 'bg-gray-100',
      text: 'Unverified',
      description: 'Identity not verified',
      verifiedCount: 0,
      totalCount,
    };
  } else if (verifiedCount === totalCount) {
    return {
      icon: 'CheckCircle',
      color: 'text-green-600',
      bgColor: 'bg-green-100',
      text: 'Fully Verified',
      description: 'All verifications complete',
      verifiedCount,
      totalCount,
    };
  } else {
    return {
      icon: 'AlertCircle',
      color: 'text-yellow-600',
      bgColor: 'bg-yellow-100',
      text: 'Partially Verified',
      description: `${verifiedCount} of ${totalCount} verifications complete`,
      verifiedCount,
      totalCount,
    };
  }
}
