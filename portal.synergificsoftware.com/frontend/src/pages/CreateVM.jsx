import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cloudLabelFor } from '../utils/cloudLabels';
import apiCaller from '../services/apiCaller';
import { parseEmailFile } from '../utils/csvEmailParser';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Server,
  Cpu,
  Database,
  HardDrive,
  Save,
  DollarSign,
  X,
  Plus,
  CheckCircle,
  Trash,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  ShoppingCart,
  Package,
  Users,
  Clock,
  Monitor,
  Mail,
  BookOpen,
  Zap,
  Shield,
  Cloud,
  Cpu as CpuIcon,
  MemoryStick,
  HardDrive as StorageIcon,
  RotateCcw,
  Undo2,
  Upload,
} from 'lucide-react';
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from 'recharts';

// ---- Visual tokens ----
const COLORS = {
  indigo: '#6366f1',
  sky: '#0ea5e9',
  green: '#10b981',
  red: '#ef4444',
  amber: '#f59e0b',
  purple: '#8b5cf6',
  slate: '#64748b',
  cardBg: 'bg-white',
  border: 'border border-slate-100',
};

const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

// Tab labels
const TAB_NAMES = ['Operating System', 'Marketplace', 'Stacks', 'ISO', 'Snapshots', 'Backups'];

// OS keywords for categorization
const OS_KEYWORDS = [
  'windows', 'ubuntu', 'rhel', 'centos', 'fedora', 'debian', 'linux', 'alma', 'rocky', 
  'redhat', 'server', 'jumpserver', 'ubuntuvtx'
];

// Marketplace keywords for categorization  
const MARKETPLACE_KEYWORDS = [
  'java', 'python', 'node', 'docker', 'kubernetes', 'terraform', 'ansible', 'jenkins',
  'mysql', 'mongodb', 'postgresql', 'redis', 'nginx', 'apache', 'react', 'android',
  'prometheus', 'grafana', 'elastic', 'kafka', 'git', 'wordpress', 'laravel', 'django'
];

// Stacks keywords
const STACKS_KEYWORDS = [
  'stack', 'lamp', 'lemp', 'mean', 'mern', 'mevn', 'elastic', 'elk', 'efk'
];

// Function to categorize template by name
function categorizeTemplateByName(templateName) {
  if (!templateName) return 'Operating System';
  
  const lowerName = templateName.toLowerCase();
  
  // Check for OS keywords
  if (OS_KEYWORDS.some(keyword => lowerName.includes(keyword))) {
    return 'Operating System';
  }
  
  // Check for Marketplace keywords
  if (MARKETPLACE_KEYWORDS.some(keyword => lowerName.includes(keyword))) {
    return 'Marketplace';
  }
  
  // Check for Stacks keywords
  if (STACKS_KEYWORDS.some(keyword => lowerName.includes(keyword))) {
    return 'Stacks';
  }
  
  // Default to OS
  return 'Operating System';
}

// Keyword image mapping (Simple Icons CDN — reliable, SVG, brand colors)
const IMAGE_KEYWORDS = {
  // ---- LONGEST / MOST SPECIFIC PATTERNS FIRST ----
  // (Insertion order is preserved; the resolver picks the FIRST match.)

  // Hexalabs custom labs / multi-word brand
  'powerbi-sql': 'https://upload.wikimedia.org/wikipedia/commons/c/cf/New_Power_BI_Logo.svg',
  'powerbi':     'https://upload.wikimedia.org/wikipedia/commons/c/cf/New_Power_BI_Logo.svg',
  'power-bi':    'https://upload.wikimedia.org/wikipedia/commons/c/cf/New_Power_BI_Logo.svg',
  'docker-guidedlab': 'https://cdn.simpleicons.org/docker/2496ED',
  'devops-guidedlab': 'https://cdn.simpleicons.org/githubactions/2088FF',
  'devops':           'https://cdn.simpleicons.org/githubactions/2088FF',
  'guidedlab':        'https://cdn.simpleicons.org/coursera/0056D2',

  // Cloud & data platforms
  'azure-databricks': 'https://cdn.simpleicons.org/databricks/FF3621',
  'databricks':       'https://cdn.simpleicons.org/databricks/FF3621',
  'snowflake':        'https://cdn.simpleicons.org/snowflake/29B5E8',

  // Windows family (longer patterns first)
  'win-hyperv': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/windows11/windows11-original.svg',
  'hyperv':     'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/windows11/windows11-original.svg',
  'jumpserver': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/windows11/windows11-original.svg',
  'windows-test': 'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/windows11/windows11-original.svg',
  'windows':      'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/windows11/windows11-original.svg',
  'win-':         'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/windows11/windows11-original.svg',

  // Linux distros
  'ubuntuvtx': 'https://cdn.simpleicons.org/ubuntu/E95420',
  'ubuntu':    'https://cdn.simpleicons.org/ubuntu/E95420',
  'rhel':      'https://cdn.simpleicons.org/redhat/EE0000',
  'redhat':    'https://cdn.simpleicons.org/redhat/EE0000',
  'centos':    'https://cdn.simpleicons.org/centos/262577',
  'alma':      'https://cdn.simpleicons.org/almalinux/000000',
  'rocky':     'https://cdn.simpleicons.org/rockylinux/10B981',
  'fedora':    'https://cdn.simpleicons.org/fedora/51A2DA',
  'debian':    'https://cdn.simpleicons.org/debian/A81D33',
  'kali':      'https://cdn.simpleicons.org/kalilinux/557C94',

  // CI/CD & dev tools
  'jenkinsci': 'https://cdn.simpleicons.org/jenkins/D24939',
  'jenkins':   'https://cdn.simpleicons.org/jenkins/D24939',
  'gitlab':    'https://cdn.simpleicons.org/gitlab/FC6D26',
  'github':    'https://cdn.simpleicons.org/github/181717',
  'circleci':  'https://cdn.simpleicons.org/circleci/343434',
  'argocd':    'https://cdn.simpleicons.org/argo/EF7B4D',
  'git':       'https://cdn.simpleicons.org/git/F05032',

  // Config mgmt / IaC
  'ansible-controller': 'https://cdn.simpleicons.org/ansible/EE0000',
  'ansible-node':       'https://cdn.simpleicons.org/ansible/EE0000',
  'ansible-winnode':    'https://cdn.simpleicons.org/ansible/EE0000',
  'ansible':            'https://cdn.simpleicons.org/ansible/EE0000',
  'terraform':          'https://cdn.simpleicons.org/terraform/844FBA',
  'puppet':             'https://cdn.simpleicons.org/puppet/FFAE1A',
  'chef':               'https://cdn.simpleicons.org/jenkins/D24939',
  'vagrant':            'https://cdn.simpleicons.org/vagrant/1868F2',

  // Containers / orchestration
  'kubernetes': 'https://cdn.simpleicons.org/kubernetes/326CE5',
  'k8s':        'https://cdn.simpleicons.org/kubernetes/326CE5',
  'openshift':  'https://cdn.simpleicons.org/redhatopenshift/EE0000',
  'docker':     'https://cdn.simpleicons.org/docker/2496ED',
  'rancher':    'https://cdn.simpleicons.org/rancher/0075A8',

  // Databases
  'postgredocker': 'https://cdn.simpleicons.org/postgresql/4169E1',
  'postgres':      'https://cdn.simpleicons.org/postgresql/4169E1',
  'mysql':         'https://cdn.simpleicons.org/mysql/4479A1',
  'mariadb':       'https://cdn.simpleicons.org/mariadb/003545',
  'mongodb':       'https://cdn.simpleicons.org/mongodb/47A248',
  'mongo':         'https://cdn.simpleicons.org/mongodb/47A248',
  'redis':         'https://cdn.simpleicons.org/redis/DC382D',
  'cassandra':     'https://cdn.simpleicons.org/apachecassandra/1287B1',
  'cockroach':     'https://cdn.simpleicons.org/cockroachlabs/6933FF',
  'sqlserver':     'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/microsoftsqlserver/microsoftsqlserver-plain.svg',
  'mssql':         'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/microsoftsqlserver/microsoftsqlserver-plain.svg',
  'sql':           'https://cdn.jsdelivr.net/gh/devicons/devicon/icons/microsoftsqlserver/microsoftsqlserver-plain.svg',

  // Observability
  'prometheus':    'https://cdn.simpleicons.org/prometheus/E6522C',
  'grafana_labs':  'https://cdn.simpleicons.org/grafana/F46800',
  'grafana':       'https://cdn.simpleicons.org/grafana/F46800',
  'elasticsearch': 'https://cdn.simpleicons.org/elasticsearch/005571',
  'elastic':       'https://cdn.simpleicons.org/elasticstack/005571',
  'logstash':      'https://cdn.simpleicons.org/logstash/005571',
  'kibana':        'https://cdn.simpleicons.org/kibana/005571',
  'datadog':       'https://cdn.simpleicons.org/datadog/632CA6',
  'splunk':        'https://cdn.simpleicons.org/splunk/000000',
  'newrelic':      'https://cdn.simpleicons.org/newrelic/008C99',

  // Web servers / runtimes
  'apache':  'https://cdn.simpleicons.org/apache/D22128',
  'nginx':   'https://cdn.simpleicons.org/nginx/009639',
  'tomcat':  'https://cdn.simpleicons.org/apachetomcat/F8DC75',

  // Languages / frameworks
  'wordpress': 'https://cdn.simpleicons.org/wordpress/21759B',
  'laravel':   'https://cdn.simpleicons.org/laravel/FF2D20',
  'django':    'https://cdn.simpleicons.org/django/092E20',
  'flask':     'https://cdn.simpleicons.org/flask/000000',
  'react':     'https://cdn.simpleicons.org/react/61DAFB',
  'vue':       'https://cdn.simpleicons.org/vuedotjs/4FC08D',
  'angular':   'https://cdn.simpleicons.org/angular/DD0031',
  'spring':    'https://cdn.simpleicons.org/spring/6DB33F',
  'java':      'https://cdn.simpleicons.org/openjdk/000000',
  'python':    'https://cdn.simpleicons.org/python/3776AB',
  'node':      'https://cdn.simpleicons.org/nodedotjs/339933',
  'android':   'https://cdn.simpleicons.org/android/3DDC84',
  'ios':       'https://cdn.simpleicons.org/apple/000000',

  // Big data / streaming
  'rabbitmq': 'https://cdn.simpleicons.org/rabbitmq/FF6600',
  'kafka':    'https://cdn.simpleicons.org/apachekafka/231F20',
  'spark':    'https://cdn.simpleicons.org/apachespark/E25A1C',
  'hadoop':   'https://cdn.simpleicons.org/apachehadoop/66CCFF',
  'airflow':  'https://cdn.simpleicons.org/apacheairflow/017CEE',
  'flink':    'https://cdn.simpleicons.org/apacheflink/E6526F',

  // AI / GenAI
  'genai':    'https://upload.wikimedia.org/wikipedia/commons/4/4d/OpenAI_Logo.svg',
  'openai':   'https://upload.wikimedia.org/wikipedia/commons/4/4d/OpenAI_Logo.svg',
  'huggingface': 'https://cdn.simpleicons.org/huggingface/FFD21E',

  // Misc
  'valheim':  'https://cdn.simpleicons.org/linux/FCC624',
  'linux':    'https://cdn.simpleicons.org/linux/FCC624',
};

// Inline SVG fallback — never 404s. Generic server/cloud glyph.
const FALLBACK_ICON = "data:image/svg+xml;utf8," + encodeURIComponent(
  '<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"#475569\" stroke-width=\"1.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"3\" y=\"4\" width=\"18\" height=\"6\" rx=\"1.5\"/><rect x=\"3\" y=\"14\" width=\"18\" height=\"6\" rx=\"1.5\"/><circle cx=\"7\" cy=\"7\" r=\"0.8\" fill=\"#475569\"/><circle cx=\"7\" cy=\"17\" r=\"0.8\" fill=\"#475569\"/></svg>'
);

// Function to get image URL for a template name
function getImageForTemplate(name, osHint, cloudHint) {
  // Hexalabs brand discipline: never serve a vendor logo (AWS / Azure / GCP / OCI).
  // For cloud-tagged templates we strip the cloud prefix so the lookup matches the
  // OS / app inside the template name rather than the vendor wordmark.
  let lookupName = (name || '');
  if (cloudHint === 'aws' || lookupName.toLowerCase().startsWith('aws-')) {
    lookupName = lookupName.replace(/^aws[-_]?/i, '');
  } else if (cloudHint === 'gcp' || lookupName.toLowerCase().startsWith('gcp-')) {
    lookupName = lookupName.replace(/^gcp[-_]?/i, '');
  } else if (cloudHint === 'oci' || lookupName.toLowerCase().startsWith('oci-')) {
    lookupName = lookupName.replace(/^oci[-_]?/i, '');
  }
  name = lookupName;
  const lowerName = (name || '').toLowerCase();
  // Insertion-ordered keys: longest/most-specific patterns are listed first in IMAGE_KEYWORDS.
  if (lowerName) {
    for (const key of Object.keys(IMAGE_KEYWORDS)) {
      if (lowerName.includes(key)) return IMAGE_KEYWORDS[key];
    }
  }
  // Fall back to display.os hint (Windows / Linux / Ubuntu / etc.)
  const lowerOs = (osHint || '').toLowerCase();
  if (lowerOs) {
    for (const key of Object.keys(IMAGE_KEYWORDS)) {
      if (lowerOs.includes(key)) return IMAGE_KEYWORDS[key];
    }
    if (lowerOs.includes('linux')) return IMAGE_KEYWORDS.linux;
    if (lowerOs.includes('windows') || lowerOs.includes('server')) return IMAGE_KEYWORDS.windows;
  }
  return FALLBACK_ICON;
}

// Function to categorize templates by name
function categorizeTemplatesByName(templates) {
  const categorized = {
    'Operating System': [],
    'Marketplace': [],
    'Stacks': [],
    'ISO': [],
    'Snapshots': [],
    'Backups': []
  };

  templates.forEach(template => {
    const templateName = template.name || template.display?.os || 'Unknown';
    const category = categorizeTemplateByName(templateName);
    categorized[category].push(template);
  });

  return categorized;
}

// ---- Small UI pieces ----
const IconBox = ({ children }) => (
  <div className="p-2 rounded-lg bg-slate-100 inline-flex items-center justify-center">{children}</div>
);

const KPI = ({ label, value, hint, icon }) => (
  <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={`p-4 rounded-xl ${COLORS.border} ${COLORS.cardBg} shadow-sm`}>
    <div className="flex items-start justify-between">
      <div>
        <div className="text-sm text-slate-500">{label}</div>
        <div className="mt-2 text-xl font-semibold text-gray-900">{value}</div>
        {hint ? <div className="text-xs text-slate-400 mt-1">{hint}</div> : null}
      </div>
      <div>{icon}</div>
    </div>
  </motion.div>
);

// Template Card Component - Fixed version
const TemplateCard = ({ template, onClick, badge, showRate = false }) => {
  const name = template.name || template.display?.os || 'Unknown';
  const description = template.description || template.display?.description || 'No description available';
  const icon = getImageForTemplate(name, template.display?.os, template.cloud || template.creation?.cloud);
  const rate = showRate ? (template.rate ? INR.format(Number(template.rate)) : 'Free') : null;

  const handleDeployClick = () => {
    onClick(template);
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      whileHover={{ scale: 1.02 }}
      className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-all duration-200"
    >
      <div className="flex items-start justify-between mb-3">
        <img src={icon} alt={name} className="w-12 h-12 object-contain" onError={(e) => { if (e.target.src !== FALLBACK_ICON) e.target.src = FALLBACK_ICON; }} />
        {(() => {
          const lbl = cloudLabelFor(template.cloud || template.creation?.cloud || 'azure', 'admin');
          return (
            <span title={lbl.sub} className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${lbl.chipClass}`}>
              {lbl.codename.replace('Hexalabs ', '')}
            </span>
          );
        })()}
        {badge && (
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${
            badge === 'OS' ? 'bg-blue-100 text-blue-600' :
            badge === 'App' ? 'bg-green-100 text-green-600' :
            badge === 'Stack' ? 'bg-purple-100 text-purple-600' :
            'bg-gray-100 text-gray-600'
          }`}>
            {badge}
          </span>
        )}
      </div>
      
      <h3 className="font-semibold text-slate-800 mb-1">{name}</h3>
      <p className="text-sm text-slate-600 mb-3 line-clamp-2">{description}</p>
      
      <div className="flex items-center justify-between">
        {rate && <span className="text-sm font-medium text-slate-700">{rate}</span>}
        <button
          onClick={handleDeployClick}
          className="text-xs px-3 py-1 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-lg transition-colors font-medium ml-auto"
        >
          Deploy
        </button>
      </div>
    </motion.div>
  );
};

// Step Indicator Component
const StepIndicator = ({ currentStep, totalSteps }) => {
  return (
    <div className="flex items-center justify-center mb-6">
      {Array.from({ length: totalSteps }).map((_, index) => (
        <React.Fragment key={index}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
            index + 1 === currentStep
              ? 'bg-blue-600 text-white'
              : index + 1 < currentStep
              ? 'bg-green-500 text-white'
              : 'bg-slate-200 text-slate-400'
          }`}>
            {index + 1 < currentStep ? <CheckCircle className="w-4 h-4" /> : index + 1}
          </div>
          {index < totalSteps - 1 && (
            <div className={`w-12 h-1 mx-2 ${
              index + 1 < currentStep ? 'bg-green-500' : 'bg-slate-200'
            }`} />
          )}
        </React.Fragment>
      ))}
    </div>
  );
};

// Feature Badge Component
const FeatureBadge = ({ icon: Icon, label, value, color = 'blue' }) => (
  <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
    <div className={`p-2 rounded-lg ${
      color === 'blue' ? 'bg-blue-100' :
      color === 'green' ? 'bg-green-100' :
      color === 'amber' ? 'bg-amber-100' :
      'bg-purple-100'
    }`}>
      <Icon className={`w-4 h-4 ${
        color === 'blue' ? 'text-blue-600' :
        color === 'green' ? 'text-green-600' :
        color === 'amber' ? 'text-amber-600' :
        'text-purple-600'
      }`} />
    </div>
    <div className="flex-1">
      <div className="text-sm font-medium text-slate-700">{label}</div>
      <div className="text-xs text-slate-500">{value}</div>
    </div>
  </div>
);

// Email Token Component
const EmailToken = ({ email, isValid, onRemove, index }) => (
  <div className={`flex items-center gap-2 text-sm px-3 py-2 rounded-full transition-all duration-200 ${
    isValid 
      ? 'bg-green-100 text-green-700 border border-green-200 hover:bg-green-200' 
      : 'bg-red-100 text-red-700 border border-red-200 hover:bg-red-200'
  }`}>
    <Mail className="w-3 h-3" />
    <span className="max-w-[120px] truncate">{email}</span>
    <button 
      onClick={() => onRemove(index)}
      className="opacity-70 hover:opacity-100 transition-opacity p-0.5 rounded"
    >
      <X className="w-3 h-3" />
    </button>
  </div>
);

// Invisible Scroll Area Component
const InvisibleScrollArea = ({ children, className = "", maxHeight = "auto" }) => (
  <div 
    className={`
      overflow-auto
      [&::-webkit-scrollbar]:w-0
      [&::-webkit-scrollbar]:h-0
      [&::-webkit-scrollbar-track]:bg-transparent
      [&::-webkit-scrollbar-thumb]:bg-transparent
      [&::-webkit-scrollbar-thumb]:rounded-none
      hover:[&::-webkit-scrollbar-thumb]:bg-transparent
      ${className}
    `}
    style={{ maxHeight }}
  >
    {children}
  </div>
);

// small hook: effect once
function useEffectOnce(fn) {
  useEffect(fn, []); // eslint-disable-line react-hooks/exhaustive-deps
}

// ---- Main component ----
export default function CreateVMDashboard({ userDetails = {}, apiRoutes = {} }) {
  // Data
  const [templates, setTemplates] = useState([]);
  const [categorizedTemplates, setCategorizedTemplates] = useState({});
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [error, setError] = useState('');

  // Modal & form
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [emailTokens, setEmailTokens] = useState([]);
  const [trainingName, setTrainingName] = useState('');
  const [allocatedHours, setAllocatedHours] = useState(1);
  const [guacamole, setGuacamole] = useState(false);
  const [autoShutdown, setAutoShutdown] = useState(false);
  const [idleMinutes, setIdleMinutes] = useState(30);
  const [labExpiry, setLabExpiry] = useState(false);
  const [expiryDate, setExpiryDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);

  // UI
  const [toast, setToast] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const abortRef = useRef(null);
  const emailInputRef = useRef(null);
  const emailContainerRef = useRef(null);
  const csvFileRef = useRef(null);
  const [csvUploadStatus, setCsvUploadStatus] = useState(null);

  // Live deploy progress — persisted in localStorage so a page refresh
  // doesn't drop the progress card. Max 2h lifetime; stale entries
  // older than that are discarded on load.
  const DEPLOY_PROGRESS_KEY = 'getlabs.deployProgress';
  const DEPLOY_PROGRESS_MAX_AGE_MS = 2 * 60 * 60 * 1000;

  const [deployProgress, setDeployProgress] = useState(() => {
    try {
      const raw = localStorage.getItem(DEPLOY_PROGRESS_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw);
      if (!p?.startedAt || Date.now() - p.startedAt > DEPLOY_PROGRESS_MAX_AGE_MS) {
        localStorage.removeItem(DEPLOY_PROGRESS_KEY);
        return null;
      }
      return p;
    } catch { return null; }
  });
  const deployPollRef = useRef(null);

  // Persist progress updates
  useEffect(() => {
    if (!deployProgress) { try { localStorage.removeItem(DEPLOY_PROGRESS_KEY); } catch {} return; }
    try { localStorage.setItem(DEPLOY_PROGRESS_KEY, JSON.stringify(deployProgress)); } catch {}
  }, [deployProgress]);

  useEffect(() => () => { if (deployPollRef.current) clearInterval(deployPollRef.current); }, []);

  const startDeployTracking = useCallback((trainingName, expectedCount, startedAt = Date.now()) => {
    setDeployProgress({ trainingName, expectedCount, ready: 0, total: 0, startedAt, vms: [], finished: false });
    if (deployPollRef.current) clearInterval(deployPollRef.current);
    const tick = async () => {
      try {
        const res = await apiCaller.get('/azure/machines', { params: { trainingName } });
        const vms = (res.data || []).filter(v => v.isAlive);
        const ready = vms.filter(v => v.publicIp && v.adminPass).length;
        const finished = vms.length >= expectedCount && ready >= expectedCount;
        setDeployProgress(p => p && ({ ...p, ready, total: vms.length, vms, finished }));
        if (finished) {
          clearInterval(deployPollRef.current); deployPollRef.current = null;
        }
      } catch { /* swallow — keep polling */ }
    };
    tick();
    deployPollRef.current = setInterval(tick, 12000);
  }, []);

  // Resume polling after a refresh if we loaded progress from localStorage
  useEffect(() => {
    if (deployProgress && !deployProgress.finished && !deployPollRef.current) {
      startDeployTracking(deployProgress.trainingName, deployProgress.expectedCount, deployProgress.startedAt);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // per-second UI tick: forces re-render so elapsed time + time-based % update
  // smoothly between server polls (which only fire every 12s). Without this,
  // the progress bar appears frozen and only moves on manual Refresh.
  const [, setUiTick] = useState(0);
  useEffect(() => {
    if (!deployProgress || deployProgress.finished) return;
    const id = setInterval(() => setUiTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, [deployProgress?.startedAt, deployProgress?.finished]);

  const stopDeployTracking = useCallback(() => {
    if (deployPollRef.current) { clearInterval(deployPollRef.current); deployPollRef.current = null; }
    setDeployProgress(null);
  }, []);

  // Active tab state
  const [activeTab, setActiveTab] = useState('Operating System');

  // Fetch templates
  const fetchTemplates = useCallback(async () => {
    if (!apiRoutes.templatesApi) return;
    try {
      setLoadingTemplates(true);
      setError('');
      if (abortRef.current) abortRef.current.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const q = `organization=${encodeURIComponent(userDetails.organization || '')}`;
      const res = await apiCaller.get(`${apiRoutes.templatesApi}?${q}`, { signal: controller.signal });
      
      const data = res?.data ?? [];
      const items = Array.isArray(data) ? data : data.templates ?? data.items ?? [];
      
      setTemplates(items);
      setCategorizedTemplates(categorizeTemplatesByName(items));
    } catch (err) {
      if (err?.name === 'AbortError') return;
      console.error('Error fetching templates:', err);
      setError('Failed to load templates.');
    } finally {
      setLoadingTemplates(false);
    }
  }, [apiRoutes.templatesApi, userDetails.organization]);

  useEffect(() => {
    fetchTemplates();
    return () => { if (abortRef.current) abortRef.current.abort(); };
  }, [fetchTemplates]);

  // Get templates for current tab
  const getCurrentTabTemplates = () => {
    return categorizedTemplates[activeTab] || [];
  };

  // Derived analytics
  const analytics = useMemo(() => {
    const totalTemplates = templates.length;
    const totalVMs = templates.reduce((acc, t) => acc + (t.estimatedCount ?? 0), 0) || Math.max(0, Math.floor(totalTemplates * 3));
    const avgPrice = templates.length ? Math.round((templates.reduce((s, t) => s + (Number(t.rate || 0) || 0), 0) / templates.length)) : 0;
    const estMonthly = Math.round((allocatedHours || 1) * (totalVMs || 1) * (guacamole ? 5 : 0.8));
    
    // Marketplace-specific stats
    const marketplaceTemplates = categorizedTemplates['Marketplace'] || [];
    const marketplaceCount = marketplaceTemplates.length;
    
    return { totalTemplates, totalVMs, avgPrice, estMonthly, marketplaceCount };
  }, [templates, categorizedTemplates, allocatedHours, guacamole]);

  // Charts data
  const osDistribution = useMemo(() => {
    const osTemplates = categorizedTemplates['Operating System'] || [];
    const map = new Map();
    osTemplates.forEach((t) => {
      const os = (t.display?.os || 'Unknown').toString();
      map.set(os, (map.get(os) || 0) + 1);
    });
    const arr = Array.from(map.entries()).map(([name, value]) => ({ name, value }));
    return arr.length ? arr : [{ name: 'Windows', value: 3 }, { name: 'Linux', value: 2 }];
  }, [categorizedTemplates]);

  const hoursBarData = useMemo(() => {
    const currentTemplates = getCurrentTabTemplates();
    if (currentTemplates.length) {
      return currentTemplates.slice(0, 8).map((t, i) => ({ 
        name: t.name.slice(0, 8), 
        hours: Number(t.avgHours || (i + 1) * 2) 
      }));
    }
    return [
      { name: 'Std-A', hours: 8 },
      { name: 'Std-B', hours: 6 },
      { name: 'Std-C', hours: 12 },
      { name: 'Std-D', hours: 4 },
    ];
  }, [activeTab, categorizedTemplates]);

  // Email token handling
  const processEmailInput = (input) => {
    const list = input.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
    if (!list.length) return;
    const validated = list.map((email) => ({ email, isValid: validateEmail(email) }));
    setEmailTokens((prev) => [...prev, ...validated]);
  };

  const validateEmail = (email) => {
    const re = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[A-Za-z]{2,}$/;
    return re.test(String(email).toLowerCase());
  };

  const removeEmail = (idx) => setEmailTokens((s) => s.filter((_, i) => i !== idx));

  const removeLastEmail = () => {
    setEmailTokens((prev) => prev.slice(0, -1));
  };

  const resetAllEmails = () => {
    setEmailTokens([]);
    setCsvUploadStatus(null);
    if (emailInputRef.current) {
      emailInputRef.current.value = '';
      emailInputRef.current.focus();
    }
  };

  const handleCsvUpload = (file) => {
    if (!file) return;
    parseEmailFile(file, ({ valid, invalid, validCount, invalidCount }) => {
      // Deduplicate against existing tokens
      const existingSet = new Set(emailTokens.map(t => t.email.toLowerCase()));
      const newTokens = [];
      for (const em of valid) {
        const key = em.toLowerCase();
        if (!existingSet.has(key)) {
          existingSet.add(key);
          newTokens.push({ email: em, isValid: true });
        }
      }
      if (newTokens.length > 0) {
        setEmailTokens(prev => [...prev, ...newTokens]);
      }
      setCsvUploadStatus({ valid: newTokens.length, invalid: invalidCount });
      if (csvFileRef.current) csvFileRef.current.value = '';
    });
  };

  // Modal open with a template
  const openModal = (template) => {
    setSelectedTemplate(template);
    setModalOpen(true);
    setTrainingName('');
    setEmailTokens([]);
    setAllocatedHours(1);
    setGuacamole(false);
    setCurrentStep(1);
  };

  const closeModal = () => {
    setModalOpen(false);
    setSelectedTemplate(null);
    setCurrentStep(1);
  };

  // Navigation between steps
  const nextStep = () => {
    if (currentStep < 3) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  // Submit create VMs
  const handleSubmitCreate = async () => {
    const validEmails = emailTokens.filter((t) => t.isValid).map((t) => t.email);
    if (!selectedTemplate) {
      pushToast('Select a template first', 'error');
      return;
    }
    if (!trainingName) {
      pushToast('Please enter training name', 'error');
      return;
    }
    if (!validEmails.length) {
      pushToast('Add at least one valid email', 'error');
      return;
    }

    const createvmdata = {
      templateName: selectedTemplate.name,
      email: validEmails,
      trainingName,
      allocatedHours: (Number(allocatedHours) || 0) * 60, // minutes
      createVmCount: validEmails.length,
      guacamole,
      autoShutdown,
      idleMinutes: autoShutdown ? idleMinutes : 0,
      expiresAt: labExpiry && expiryDate ? new Date(expiryDate).toISOString() : null,
    };

    setConfirm({
      message: `Create ${validEmails.length} VM(s) using "${selectedTemplate.name}" for training "${trainingName}"?`,
      async onConfirm() {
        setConfirm(null);
        try {
          setSubmitting(true);
          const response = await apiCaller.post(`${apiRoutes.machineApi}`, createvmdata);
          pushToast(response?.data?.message ?? 'VM creation started', 'success');
          // Start polling Lab Console for these VMs so the user sees them
          // come up live (was previously a 5-10 min black box).
          startDeployTracking(trainingName, validEmails.length);
          closeModal();
          fetchTemplates();
        } catch (err) {
          console.error('Error creating VMs:', err);
          pushToast('Failed to create VMs', 'error');
        } finally {
          setSubmitting(false);
        }
      },
    });
  };

  // small pushToast
  const pushToast = (msg, variant = 'info') => {
    setToast({ id: Date.now(), msg, variant });
  };

  // Confirm modal helpers
  const handleConfirmCancel = () => setConfirm(null);

  // currency format for template rate (t.rate)
  const formatRate = (r) => {
    try {
      const num = Number(r || 0);
      return INR.format(num);
    } catch {
      return r ?? '-';
    }
  };

  // confirmation modal component
  const ConfirmationModal = ({ payload }) => (
    <AnimatePresence>
      {payload && (
        <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <motion.div initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 12, opacity: 0 }} className="w-full max-w-lg bg-white rounded-xl p-6 shadow-sm">
            <div className="flex items-start justify-between">
              <div>
                <h4 className="text-lg font-semibold">Confirm Action</h4>
                <p className="text-sm text-slate-500 mt-1">{payload.message}</p>
              </div>
              <button className="text-slate-400" onClick={() => setConfirm(null)}><X className="w-5 h-5" /></button>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button onClick={handleConfirmCancel} className="px-4 py-2 rounded-lg bg-white border">Cancel</button>
              <button onClick={() => payload.onConfirm && payload.onConfirm()} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white">
                Confirm
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  // Get badge for template
  const getTemplateBadge = (template) => {
    const templateName = template.name || template.display?.os || 'Unknown';
    const category = categorizeTemplateByName(templateName);
    
    switch (category) {
      case 'Operating System': return 'OS';
      case 'Marketplace': return 'App';
      case 'Stacks': return 'Stack';
      default: return 'OS';
    }
  };

  // OS pie colors
  const PIE_COLORS = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#94a3b8'];

  return (
    <div className="max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Deploy VM</h1>
          <p className="text-sm text-gray-500 mt-0.5">Select a template and provision Azure virtual machines{userDetails.organization ? ` for ${userDetails.organization}` : ''}</p>
        </div>
        <button onClick={() => { fetchTemplates(); pushToast('Refreshed templates', 'success'); }} className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50">
          <RefreshCw className="w-3.5 h-3.5" /> Refresh
        </button>
      </div>

      {/* Live deploy progress (shows after submit, polls Lab Console) */}
      {deployProgress && (() => {
        const elapsedMin = Math.floor((Date.now() - deployProgress.startedAt) / 60000);
        const elapsedSec = Math.floor((Date.now() - deployProgress.startedAt) / 1000) % 60;
        const ESTIMATED_MIN = 8;
        const pctTime = Math.min(95, Math.round(((Date.now() - deployProgress.startedAt) / 60000 / ESTIMATED_MIN) * 100));
        const pctActual = deployProgress.expectedCount > 0 ? Math.round((deployProgress.ready / deployProgress.expectedCount) * 100) : 0;
        const pct = deployProgress.finished ? 100 : Math.max(pctActual, pctTime);
        return (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="text-sm font-semibold text-blue-900">
                {deployProgress.finished
                  ? `All ${deployProgress.expectedCount} VMs ready for "${deployProgress.trainingName}"`
                  : `Provisioning ${deployProgress.expectedCount} VM${deployProgress.expectedCount > 1 ? 's' : ''} for "${deployProgress.trainingName}"...`}
              </div>
              <button onClick={stopDeployTracking} className="text-xs text-blue-700 hover:underline">Hide</button>
            </div>
            <div className="text-xs text-blue-700 mb-2 tabular-nums">
              {deployProgress.ready}/{deployProgress.expectedCount} ready · {deployProgress.total} created · {elapsedMin}m {elapsedSec}s elapsed{!deployProgress.finished && ` · ~${Math.max(0, ESTIMATED_MIN - elapsedMin)}m left`}
            </div>
            <div className="w-full bg-blue-100 rounded-full h-2 overflow-hidden">
              <div className={`h-2 rounded-full transition-all duration-500 ${deployProgress.finished ? 'bg-green-500' : 'bg-blue-500'}`} style={{ width: `${pct}%` }} />
            </div>
            {deployProgress.vms.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {deployProgress.vms.map(vm => {
                  const ready = vm.publicIp && vm.adminPass;
                  return (
                    <span key={vm._id} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium ${ready ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {ready ? '✓' : '⋯'} {vm.name}
                    </span>
                  );
                })}
              </div>
            )}
            <p className="text-[11px] text-blue-600 mt-2">
              View full details + access credentials on the Lab Console once VMs are ready.
            </p>
          </div>
        );
      })()}

      {/* KPIs - Updated with marketplace count */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-6">
        <KPI label="Templates Available" value={analytics.totalTemplates} hint="Ready to provision" icon={<IconBox><Cpu className="w-5 h-5 text-indigo-600" /></IconBox>} />
        <KPI label="Marketplace Apps" value={analytics.marketplaceCount} hint="Applications & Stacks" icon={<IconBox><ShoppingCart className="w-5 h-5 text-sky-600" /></IconBox>} />
        {(userDetails?.userType === 'admin' || userDetails?.userType === 'superadmin') && <KPI label="Avg. Price" value={INR.format(analytics.avgPrice || 0)} hint="Per template (approx)" icon={<IconBox><DollarSign className="w-5 h-5 text-green-600" /></IconBox>} />}
        <KPI label="Est. Monthly Usage" value={`${analytics.estMonthly} hrs`} hint="Illustrative" icon={<IconBox><HardDrive className="w-5 h-5 text-slate-700" /></IconBox>} />
      </div>

      {/* Content: templates */}
      <div className="min-h-0">
        <div className="min-h-0">
          <div className="rounded-xl bg-white border border-slate-100 shadow-sm h-full flex flex-col">
            {/* Header */}
            <div className="p-4 border-b border-slate-200">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-lg font-semibold text-slate-800">Select Template <span className="text-blue-600 cursor-pointer font-bold">Info</span></div>
                  <div className="text-xs text-slate-400">Operating System, Marketplace, Stacks, ISO, Snapshot, Backups</div>
                </div>
                <div className="text-sm text-slate-500">
                  {getCurrentTabTemplates().length} templates available
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="px-4 border-b border-slate-200">
              <InvisibleScrollArea>
                <div className="flex space-x-6 text-sm font-medium select-none">
                  {TAB_NAMES.map((tab) => (
                    <button
                      key={tab}
                      className={`py-3 whitespace-nowrap border-b-2 transition-colors ${
                        activeTab === tab 
                          ? 'text-blue-600 border-blue-600 font-semibold' 
                          : 'text-slate-400 border-transparent hover:text-slate-600'
                      }`}
                      onClick={() => setActiveTab(tab)}
                    >
                      {tab} {categorizedTemplates[tab] && `(${categorizedTemplates[tab].length})`}
                    </button>
                  ))}
                </div>
              </InvisibleScrollArea>
            </div>

            {/* Content - Scrollable Area */}
            <div className="flex-1 min-h-0 p-4">
              <InvisibleScrollArea maxHeight="500px">
                {loadingTemplates ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {[...Array(6)].map((_, i) => (
                      <div key={i} className="animate-pulse bg-slate-100 rounded-xl p-4 h-32"></div>
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {getCurrentTabTemplates().length > 0 ? (
                      getCurrentTabTemplates().map((template, idx) => (
                        <TemplateCard
                          key={idx}
                          template={template}
                          onClick={openModal}
                          badge={getTemplateBadge(template)}
                          showRate={userDetails?.userType === 'admin' || userDetails?.userType === 'superadmin'}
                        />
                      ))
                    ) : (
                      <div className="col-span-3 text-center py-12 text-slate-400">
                        <Package className="w-12 h-12 mx-auto mb-3 opacity-50" />
                        <div>No templates available for {activeTab}</div>
                        <div className="text-sm mt-1">Check back later or contact administrator</div>
                      </div>
                    )}
                  </div>
                )}
              </InvisibleScrollArea>
            </div>
          </div>
        </div>

      </div>

      {/* Enhanced Modal: Create VM */}
      <AnimatePresence>
        {modalOpen && selectedTemplate && (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <motion.div initial={{ y: 12, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 12, opacity: 0 }} className="w-full max-w-4xl rounded-xl bg-white shadow-xl max-h-[90vh] flex flex-col">
              {/* Header */}
              <div className="flex items-center justify-between p-6 border-b border-slate-200">
                <div className="flex items-center gap-4">
                  <div className="p-2 rounded-lg bg-blue-100">
                    <Cloud className="w-6 h-6 text-blue-600" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-gray-900">Deploy Virtual Machines</h3>
                    <div className="text-[11px] text-gray-500">Configure resources, assign users, and launch</div>
                  </div>
                </div>
                <button onClick={closeModal} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                  <X className="w-5 h-5 text-slate-400" />
                </button>
              </div>

              {/* Step Indicator */}
              <div className="px-6 pt-6">
                <StepIndicator currentStep={currentStep} totalSteps={3} />
              </div>

              {/* Content - Scrollable Area */}
              <div className="flex-1 min-h-0">
                <InvisibleScrollArea maxHeight="calc(90vh - 280px)" className="p-6">
                  {currentStep === 1 && (
                    <div className="space-y-6">
                      {/* Template Info and Form in single column for better visibility */}
                      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Template Info */}
                        <div className="lg:col-span-1">
                          <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                            <div className="flex items-center gap-3 mb-4">
                              <img 
                                src={getImageForTemplate(selectedTemplate.name, selectedTemplate.display?.os, selectedTemplate.cloud || selectedTemplate.creation?.cloud)} 
                                alt={selectedTemplate.name} 
                                className="w-12 h-12 object-contain"
                               onError={(e) => { if (e.target.src !== FALLBACK_ICON) e.target.src = FALLBACK_ICON; }} />
                              <div>
                                <h4 className="font-semibold text-slate-800">{selectedTemplate.name}</h4>
                                <p className="text-sm text-slate-500">{selectedTemplate.description || 'No description available'}</p>
                              </div>
                            </div>
                            
                            <div className="space-y-3">
                              <FeatureBadge
                                icon={CpuIcon}
                                label="vCPUs"
                                value={selectedTemplate.display?.cpu || "N/A"}
                                color="blue"
                              />

                              <FeatureBadge
                                icon={MemoryStick}
                                label="Memory"
                                value={selectedTemplate.display?.memory || "N/A"}
                                color="green"
                              />

                              <FeatureBadge
                                icon={StorageIcon}
                                label="Storage"
                                value={selectedTemplate.display?.storage || "N/A"}
                                color="amber"
                              />

                              <FeatureBadge icon={Shield} label="Security" value="Standard" color="purple" />
                            </div>

                            {(userDetails?.userType === 'admin' || userDetails?.userType === 'superadmin') && (
                            <div className="mt-4 p-3 bg-white rounded-lg border border-slate-200">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium text-slate-700">Base Price</span>
                                <span className="text-lg font-bold text-slate-800">{formatRate(selectedTemplate.rate)}/hr</span>
                              </div>
                            </div>
                            )}
                          </div>
                        </div>

                        {/* Configuration Form */}
                        <div className="lg:col-span-2 space-y-6">
                          <div>
                            <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-3">
                              <BookOpen className="w-4 h-4" />
                              Training Details
                            </label>
                            <input
                              value={trainingName}
                              onChange={(e) => setTrainingName(e.target.value)}
                              className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-200 focus:border-blue-500"
                              placeholder="Enter training session name (e.g., 'Python Bootcamp 2024')"
                            />
                          </div>

                          <div>
                            <div className="flex items-center justify-between mb-3">
                              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                                <Users className="w-4 h-4" />
                                Participant Emails
                              </label>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => csvFileRef.current?.click()}
                                  className="flex items-center gap-1 text-xs px-2 py-1 text-blue-600 hover:text-blue-700 transition-colors"
                                >
                                  <Upload className="w-3 h-3" />
                                  Upload CSV
                                </button>
                                <input
                                  ref={csvFileRef}
                                  type="file"
                                  accept=".csv,.txt,.xlsx"
                                  className="hidden"
                                  onChange={(e) => handleCsvUpload(e.target.files?.[0])}
                                />
                                {emailTokens.length > 0 && (
                                  <>
                                    <button
                                      onClick={removeLastEmail}
                                      className="flex items-center gap-1 text-xs px-2 py-1 text-amber-600 hover:text-amber-700 transition-colors"
                                    >
                                      <Undo2 className="w-3 h-3" />
                                      Undo Last
                                    </button>
                                    <button
                                      onClick={resetAllEmails}
                                      className="flex items-center gap-1 text-xs px-2 py-1 text-red-600 hover:text-red-700 transition-colors"
                                    >
                                      <RotateCcw className="w-3 h-3" />
                                      Reset All
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                            
                            <InvisibleScrollArea maxHeight="192px">
                              <div 
                                ref={emailContainerRef}
                                className="min-h-[60px] border border-slate-200 p-3 rounded-xl bg-white"
                              >
                                <div className="flex flex-wrap gap-2">
                                  {emailTokens.map((token, index) => (
                                    <EmailToken
                                      key={index}
                                      email={token.email}
                                      isValid={token.isValid}
                                      onRemove={removeEmail}
                                      index={index}
                                    />
                                  ))}
                                  <input
                                    ref={emailInputRef}
                                    type="text"
                                    placeholder={emailTokens.length === 0 ? "Enter email and press Enter, comma, or semicolon" : "Add more emails..."}
                                    className="flex-grow min-w-[200px] bg-transparent outline-none text-sm px-2 placeholder-slate-400"
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
                                        e.preventDefault();
                                        processEmailInput(e.target.value);
                                        e.target.value = '';
                                        // Scroll to bottom when adding new emails
                                        setTimeout(() => {
                                          if (emailContainerRef.current) {
                                            emailContainerRef.current.scrollTop = emailContainerRef.current.scrollHeight;
                                          }
                                        }, 0);
                                      }
                                    }}
                                    onBlur={(e) => { 
                                      processEmailInput(e.target.value); 
                                      e.target.value = '';
                                    }}
                                  />
                                </div>
                              </div>
                            </InvisibleScrollArea>
                            <div className="flex items-center justify-between mt-2">
                              <div className="flex items-center gap-3">
                                <span className="text-xs text-slate-400">
                                  {emailTokens.filter(t => t.isValid).length} valid emails added
                                </span>
                                {csvUploadStatus && (
                                  <span className="text-xs">
                                    {csvUploadStatus.valid > 0 && (
                                      <span className="text-green-600">{csvUploadStatus.valid} loaded from CSV</span>
                                    )}
                                    {csvUploadStatus.valid > 0 && csvUploadStatus.invalid > 0 && (
                                      <span className="text-slate-300 mx-1">|</span>
                                    )}
                                    {csvUploadStatus.invalid > 0 && (
                                      <span className="text-amber-600">{csvUploadStatus.invalid} invalid skipped</span>
                                    )}
                                  </span>
                                )}
                              </div>
                              <span className="text-xs text-slate-400">
                                Press Enter, comma, or semicolon to add
                              </span>
                            </div>
                          </div>

                          {/* Duration and Access Type - Now properly visible */}
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-3">
                                <Clock className="w-4 h-4" />
                                Duration
                              </label>
                              <div className="flex items-center gap-3">
                                <input
                                  type="number"
                                  min={1}
                                  max={720}
                                  value={allocatedHours}
                                  onChange={(e) => setAllocatedHours(Number(e.target.value))}
                                  className="flex-1 px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-200 focus:border-blue-500"
                                  placeholder="Enter hours"
                                />
                                <span className="text-sm text-slate-500 whitespace-nowrap">hours per VM</span>
                              </div>
                              <div className="text-xs text-slate-400 mt-2">
                                Maximum 720 hours (30 days)
                              </div>
                            </div>

                            <div>
                              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-3">
                                <Monitor className="w-4 h-4" />
                                Access Type
                              </label>
                              {selectedTemplate?.dcv ? (
                                <div className="p-4 border border-emerald-200 rounded-xl bg-emerald-50">
                                  <div className="flex items-start gap-3">
                                    <div className="text-emerald-600 mt-0.5">✓</div>
                                    <div className="flex-1">
                                      <div className="text-sm font-semibold text-emerald-800">Browser Access: NICE DCV (built-in)</div>
                                      <div className="text-xs text-emerald-700 mt-1">
                                        This template ships with NICE DCV — high-FPS H.264 streaming, native clipboard, no plugins. No extra charge.
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className="p-4 border border-slate-200 rounded-xl bg-white hover:bg-slate-50 transition-colors cursor-pointer">
                                  <label className="flex items-start gap-3 cursor-pointer">
                                    <input
                                      type="checkbox"
                                      id="guacamole"
                                      checked={guacamole}
                                      onChange={(e) => setGuacamole(e.target.checked)}
                                      className="w-4 h-4 text-blue-600 rounded focus:ring-blue-200 mt-1"
                                    />
                                    <div className="flex-1">
                                      <div className="text-sm font-medium text-slate-700">Enable Browser Access (Guacamole)</div>
                                      <div className="text-xs text-slate-500 mt-1">
                                        Provides web-based access to VMs without requiring additional software
                                      </div>
                                      {(userDetails?.userType === 'admin' || userDetails?.userType === 'superadmin') && (
                                      <div className="text-xs text-blue-600 font-medium mt-1">
                                        Additional +₹5/hr per VM
                                      </div>
                                      )}
                                    </div>
                                  </label>
                                </div>
                              )}
                            </div>

                            <div>
                              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-3">
                                <Clock className="w-4 h-4" />
                                Idle Auto-Shutdown
                              </label>
                              <div className="p-4 border border-slate-200 rounded-xl bg-white hover:bg-slate-50 transition-colors cursor-pointer">
                                <label className="flex items-start gap-3 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={autoShutdown}
                                    onChange={(e) => setAutoShutdown(e.target.checked)}
                                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-200 mt-1"
                                  />
                                  <div className="flex-1">
                                    <div className="text-sm font-medium text-slate-700">Auto-stop idle VMs</div>
                                    <div className="text-xs text-slate-500 mt-1">
                                      Automatically deallocate VMs when CPU usage is below 5% for the idle period. Saves cost on unused VMs.
                                    </div>
                                    {autoShutdown && (
                                      <div className="mt-3 flex items-center gap-3">
                                        <label className="text-xs text-slate-600 font-medium">Idle timeout:</label>
                                        <select
                                          value={idleMinutes}
                                          onChange={(e) => setIdleMinutes(Number(e.target.value))}
                                          className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                        >
                                          <option value={30}>30 minutes</option>
                                          <option value={60}>1 hour</option>
                                          <option value={120}>2 hours</option>
                                        </select>
                                      </div>
                                    )}
                                    <div className="text-xs text-green-600 font-medium mt-1">
                                      {autoShutdown ? `✓ Confirmed: VMs auto-stop after ${idleMinutes} min idle` : 'Disabled — VMs stay running 24/7'}
                                    </div>
                                  </div>
                                </label>
                              </div>
                            </div>

                            <div>
                              <label className="flex items-center gap-2 text-sm font-medium text-slate-700 mb-3">
                                <Clock className="w-4 h-4" />
                                Lab Expiry (Auto-Delete)
                              </label>
                              <div className="p-4 border border-slate-200 rounded-xl bg-white hover:bg-slate-50 transition-colors">
                                <label className="flex items-start gap-3 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={labExpiry}
                                    onChange={(e) => setLabExpiry(e.target.checked)}
                                    className="w-4 h-4 text-blue-600 rounded focus:ring-blue-200 mt-1"
                                  />
                                  <div className="flex-1">
                                    <div className="text-sm font-medium text-slate-700">Set lab expiry date & time</div>
                                    <div className="text-xs text-slate-500 mt-1">
                                      All VMs will be automatically deleted (including Azure resources) at the specified date and time. A warning email is sent 1 hour before expiry.
                                    </div>
                                    {labExpiry && (
                                      <div className="mt-3">
                                        <input
                                          type="datetime-local"
                                          value={expiryDate}
                                          onChange={(e) => setExpiryDate(e.target.value)}
                                          min={new Date().toISOString().slice(0, 16)}
                                          className="text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                        />
                                        {expiryDate && (
                                          <div className="text-xs text-blue-600 font-medium mt-1">
                                            Lab will auto-delete on {new Date(expiryDate).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} IST
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    <div className="text-xs text-amber-600 font-medium mt-1">
                                      {labExpiry ? (expiryDate ? '⏰ Expiry set — VMs + all resources will be auto-deleted' : '⚠️ Select a date and time') : 'No expiry — labs run until manually deleted'}
                                    </div>
                                  </div>
                                </label>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {currentStep === 2 && (
                    <div className="space-y-6">
                      <div className="text-center">
                        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                          <CheckCircle className="w-8 h-8 text-green-600" />
                        </div>
                        <h4 className="text-lg font-semibold text-slate-800 mb-2">Configuration Complete</h4>
                        <p className="text-slate-500">Review your VM deployment details below</p>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div className="bg-slate-50 rounded-xl p-4">
                          <h5 className="font-semibold text-slate-800 mb-3">Deployment Summary</h5>
                          <div className="space-y-3">
                            <div className="flex justify-between">
                              <span className="text-sm text-slate-600">Template</span>
                              <span className="text-sm font-medium">{selectedTemplate.name}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-slate-600">Training</span>
                              <span className="text-sm font-medium">{trainingName || 'Not specified'}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-slate-600">Duration</span>
                              <span className="text-sm font-medium">{allocatedHours} hours</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-slate-600">Browser Access</span>
                              <span className="text-sm font-medium">{selectedTemplate?.dcv ? 'NICE DCV (built-in)' : (guacamole ? 'Guacamole enabled' : 'Disabled')}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-slate-600">Auto-Shutdown</span>
                              <span className={`text-sm font-medium ${autoShutdown ? 'text-green-600' : 'text-slate-500'}`}>
                                {autoShutdown ? `After ${idleMinutes} min idle` : 'Off (24/7)'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-slate-600">Lab Expiry</span>
                              <span className={`text-sm font-medium ${labExpiry && expiryDate ? 'text-amber-600' : 'text-slate-500'}`}>
                                {labExpiry && expiryDate ? new Date(expiryDate).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' }) : 'No expiry'}
                              </span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-sm text-slate-600">VMs to Create</span>
                              <span className="text-sm font-medium">{emailTokens.filter(t => t.isValid).length}</span>
                            </div>
                          </div>
                        </div>

                        {(userDetails?.userType === 'admin' || userDetails?.userType === 'superadmin') && (
                        <div className="bg-blue-50 rounded-xl p-4">
                          <h5 className="font-semibold text-slate-800 mb-3">Cost Estimate</h5>
                          <div className="space-y-2">
                            <div className="flex justify-between">
                              <span className="text-sm text-slate-600">Base Cost ({emailTokens.filter(t => t.isValid).length} VMs)</span>
                              <span className="text-sm font-medium">
                                {INR.format((Number(selectedTemplate.rate) || 0) * emailTokens.filter(t => t.isValid).length)}/hr
                              </span>
                            </div>
                            {guacamole && (
                              <div className="flex justify-between">
                                <span className="text-sm text-slate-600">Browser Access</span>
                                <span className="text-sm font-medium">
                                  {INR.format(5 * emailTokens.filter(t => t.isValid).length)}/hr
                                </span>
                              </div>
                            )}
                            <div className="border-t pt-2">
                              <div className="flex justify-between">
                                <span className="text-sm font-semibold text-slate-700">Total Estimated</span>
                                <span className="text-sm font-bold text-blue-600">
                                  {INR.format(
                                    ((Number(selectedTemplate.rate) || 0) + (guacamole ? 5 : 0)) *
                                    Math.max(1, emailTokens.filter(t => t.isValid).length)
                                  )}/hr
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                        )}
                      </div>
                    </div>
                  )}

                  {currentStep === 3 && (
                    <div className="text-center space-y-6">
                      <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto">
                        <Zap className="w-10 h-10 text-blue-600" />
                      </div>
                      <div>
                        <h4 className="text-xl font-semibold text-slate-800 mb-2">Ready to Deploy!</h4>
                        <p className="text-slate-500 max-w-md mx-auto">
                          You're about to create {emailTokens.filter(t => t.isValid).length} virtual machine(s) 
                          for <span className="font-medium">{trainingName}</span>. The deployment process will begin immediately.
                        </p>
                      </div>
                      
                      {(userDetails?.userType === 'admin' || userDetails?.userType === 'superadmin') && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 max-w-md mx-auto">
                        <div className="flex items-start gap-3">
                          <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5" />
                          <div className="text-left">
                            <div className="text-sm font-medium text-amber-800">Estimated Cost</div>
                            <div className="text-lg font-bold text-amber-900">
                              {INR.format(
                                ((Number(selectedTemplate.rate) || 0) + (guacamole ? 5 : 0)) *
                                Math.max(1, emailTokens.filter(t => t.isValid).length) *
                                allocatedHours
                              )}
                            </div>
                            <div className="text-xs text-amber-600">
                              For {allocatedHours} hours of runtime
                            </div>
                          </div>
                        </div>
                      </div>
                      )}
                    </div>
                  )}
                </InvisibleScrollArea>
              </div>

              {/* Navigation Buttons */}
              <div className="flex items-center justify-between p-6 border-t border-slate-200 bg-white rounded-b-2xl">
                <button
                  onClick={prevStep}
                  disabled={currentStep === 1}
                  className={`px-6 py-3 rounded-xl font-medium transition-colors ${
                    currentStep === 1
                      ? 'text-slate-400 cursor-not-allowed'
                      : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  Back
                </button>

                <div className="flex items-center gap-3">
                  <button
                    onClick={closeModal}
                    className="px-6 py-3 rounded-xl border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-colors"
                  >
                    Cancel
                  </button>

                  {currentStep < 3 ? (
                    <button
                      onClick={nextStep}
                      disabled={!trainingName || emailTokens.filter(t => t.isValid).length === 0}
                      className={`px-6 py-3 rounded-xl font-medium transition-colors ${
                        !trainingName || emailTokens.filter(t => t.isValid).length === 0
                          ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                          : 'bg-blue-600 text-white hover:bg-blue-700'
                      }`}
                    >
                      Continue
                    </button>
                  ) : (
                    <button
                      onClick={handleSubmitCreate}
                      disabled={submitting}
                      className="px-8 py-3 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-700 transition-colors"
                    >
                      {submitting ? (
                        <div className="flex items-center gap-2">
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Deploying...
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <Zap className="w-4 h-4" />
                          Deploy VMs
                        </div>
                      )}
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirmation modal */}
      {confirm && <ConfirmationModal payload={confirm} />}

      {/* Toast position */}
      <div className="fixed right-6 top-6 z-50">
        <AnimatePresence>
          {toast && (
            <motion.div key={toast.id} initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
              <div className="rounded-xl bg-slate-50 border border-slate-200 px-4 py-2 shadow-sm">
                <div className="text-sm">{toast.msg}</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}