// Hexalabs cloud codenames — never expose AWS/Azure/GCP/OCI to learners or org-admins.
// Reasoning: customers screen-grabbing vendor names try to bypass our portal by signing up
// directly with the cloud. Memory: [[feedback_never_expose_cost_basis]].
export const CLOUD_CODENAMES = {
  aws:   { codename: 'Hexalabs Edge',   color: 'amber',   vendor: 'AWS',   region: 'ap-south-1'   },
  azure: { codename: 'Hexalabs Core',   color: 'blue',    vendor: 'Azure', region: 'South India'  },
  gcp:   { codename: 'Hexalabs Reach',  color: 'emerald', vendor: 'GCP',   region: 'asia-south1'  },
  oci:   { codename: 'Hexalabs Vault',  color: 'rose',    vendor: 'OCI',   region: 'Mumbai'       },
};

const CHIP_COLORS = {
  amber:   'bg-amber-100 text-amber-800 border-amber-200',
  blue:    'bg-blue-100 text-blue-800 border-blue-200',
  emerald: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  rose:    'bg-rose-100 text-rose-800 border-rose-200',
  gray:    'bg-gray-100 text-gray-700 border-gray-200',
};

export function cloudLabelFor(cloud, userType) {
  const entry = CLOUD_CODENAMES[cloud] || { codename: '—', color: 'gray', vendor: '', region: '' };
  const showVendor = userType === 'superadmin';
  return {
    codename: entry.codename,
    chipClass: CHIP_COLORS[entry.color] || CHIP_COLORS.gray,
    sub: showVendor && entry.vendor ? entry.vendor + ' · ' + entry.region : '',
  };
}
