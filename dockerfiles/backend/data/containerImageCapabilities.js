/**
 * Container Image Capability Catalog
 *
 * For each image registered in services/containerService.js CONTAINER_IMAGES,
 * this file declares:
 *   - provides[]   : the software/tools/binaries already preinstalled
 *   - keywords[]   : free-form descriptors used for soft matching when the
 *                    customer's PDF mentions topics rather than tool names
 *                    (e.g. "data engineering" → matches the bigdata image)
 *   - addable[]    : software the image doesn't ship with but can be apt/pip
 *                    installed at container start (counts as a "soft hit")
 *   - notSupported[]: software that requires a different image entirely
 *
 * This is the source of truth for the Container Feasibility Engine. To add a
 * new image to the matching pool: drop a row here referencing its key from
 * CONTAINER_IMAGES. No code change needed in the engine.
 *
 * Matching is lowercase, version-stripped, and substring-tolerant. So
 * "Apache Kafka 3.7.0" in the customer PDF matches an image that lists
 * "kafka" in provides. The engine handles all of that — keep entries here
 * lowercase and short.
 */

const IMAGE_CAPABILITIES = {
  // === Docker / Kubernetes Labs (Sysbox — nested Docker/K8s in containers) ===

  'docker-k8s-lab': {
    label: 'Docker + Kubernetes Lab (nested containers)',
    category: 'bigdata',
    provides: [
      'docker', 'docker-compose', 'docker compose', 'docker buildx',
      'containerd', 'container runtime',
      'kubernetes', 'k8s', 'kubectl', 'kubeadm',
      'kind', 'k3s',
      'helm', 'k9s',
      'python', 'python3', 'pip',
      'git', 'curl', 'wget', 'vim', 'nano', 'jq', 'tmux',
      'ssh', 'sshd', 'openssh',
      'ubuntu', 'ubuntu 22.04', 'linux', 'systemd',
    ],
    keywords: [
      'docker', 'containerization', 'containers', 'devops',
      'kubernetes', 'k8s', 'cka', 'ckad', 'cks',
      'docker certified', 'dca',
      'container orchestration', 'microservices',
      'ci cd', 'cicd', 'jenkins pipeline', 'gitlab ci',
      'helm charts', 'kustomize',
    ],
    addable: ['terraform', 'ansible', 'jenkins', 'argocd', 'istio', 'nginx', 'haproxy'],
    notSupported: ['windows', 'gpu', 'vmware', 'hyperv', 'hyper-v'],
  },

  'docker-lab-basic': {
    label: 'Docker Lab — Lightweight (pre-built Sysbox image)',
    category: 'bigdata',
    provides: [
      'docker', 'docker-compose', 'containerd',
      'ubuntu', 'linux', 'systemd',
    ],
    keywords: ['docker', 'containers', 'docker basics'],
    addable: ['kubectl', 'helm', 'python', 'nodejs', 'git'],
    notSupported: ['windows', 'gpu'],
  },

  // === DevOps CI/CD ===
  'devops-cicd': {
    label: 'DevOps CI/CD — Jenkins, GitLab Runner, ArgoCD, Docker, K8s',
    category: 'bigdata',
    provides: ['jenkins', 'gitlab runner', 'gitlab-runner', 'gitlab ci', 'argocd', 'argo cd', 'gitops',
      'docker', 'docker-compose', 'containerd', 'kubernetes', 'k8s', 'kubectl', 'kind', 'helm',
      'terraform', 'ansible', 'python', 'python3', 'java', 'jre', 'git', 'ssh', 'sshd'],
    keywords: ['ci cd', 'cicd', 'continuous integration', 'continuous delivery', 'devops', 'pipeline',
      'jenkins pipeline', 'gitlab ci', 'github actions', 'argocd', 'gitops', 'infrastructure automation'],
    addable: ['sonarqube client', 'trivy', 'hadolint', 'github cli'],
    notSupported: ['windows', 'gpu'],
  },

  // === Terraform / IaC ===
  'terraform-lab': {
    label: 'Terraform + AWS/Azure/GCP CLIs — Infrastructure as Code',
    category: 'bigdata',
    provides: ['terraform', 'terragrunt', 'tflint', 'hcl',
      'aws cli', 'aws', 'azure cli', 'az', 'gcloud', 'gcp cli',
      'pulumi', 'python', 'python3', 'pip', 'boto3',
      'checkov', 'git', 'ssh', 'sshd', 'jq', 'curl'],
    keywords: ['infrastructure as code', 'iac', 'terraform', 'hashicorp', 'terraform associate',
      'cloud automation', 'aws cloudformation', 'azure bicep', 'multi-cloud', 'provisioning'],
    addable: ['ansible', 'packer', 'vault', 'consul'],
    notSupported: ['windows', 'gpu'],
  },

  // === ELK Stack ===
  'elk-stack': {
    label: 'ELK Stack — Elasticsearch, Logstash, Kibana, Filebeat',
    category: 'bigdata',
    provides: ['elasticsearch', 'elastic', 'logstash', 'kibana', 'filebeat', 'beats',
      'elk', 'elk stack', 'java', 'jre', 'python', 'python3', 'git', 'ssh', 'sshd'],
    keywords: ['elk stack', 'elastic stack', 'logging', 'log management', 'observability',
      'elastic certified', 'siem', 'log analysis', 'centralized logging', 'splunk alternative'],
    addable: ['metricbeat', 'heartbeat', 'apm-server', 'fluentd'],
    notSupported: ['windows', 'gpu'],
  },

  // === AI/ML ===
  'ai-ml-lab': {
    label: 'AI/ML Lab — TensorFlow, PyTorch, HuggingFace, JupyterLab',
    category: 'bigdata',
    provides: ['python', 'python3', 'pip', 'jupyter', 'jupyterlab',
      'tensorflow', 'tf', 'keras', 'pytorch', 'torch', 'torchvision',
      'transformers', 'huggingface', 'hugging face',
      'scikit-learn', 'sklearn', 'xgboost', 'lightgbm',
      'pandas', 'numpy', 'scipy', 'matplotlib', 'seaborn', 'plotly',
      'opencv', 'cv2', 'pillow', 'spacy', 'nltk',
      'git', 'ssh', 'sshd'],
    keywords: ['artificial intelligence', 'ai', 'machine learning', 'ml', 'deep learning', 'dl',
      'tensorflow developer', 'pytorch', 'computer vision', 'nlp', 'natural language processing',
      'huggingface', 'llm', 'large language model', 'fine tuning', 'data science',
      'neural network', 'cnn', 'rnn', 'transformer', 'bert', 'gpt'],
    addable: ['langchain', 'llamaindex', 'mlflow', 'wandb', 'dvc'],
    notSupported: ['gpu'],  // CPU-only image; for GPU use nvidia/cuda base
  },

  // === Ansible ===
  'ansible-lab': {
    label: 'Ansible Lab — Controller + 3 managed nodes (RHCE/EX294)',
    category: 'bigdata',
    provides: ['ansible', 'ansible-lint', 'molecule', 'ansible galaxy',
      'python', 'python3', 'pip', 'ssh', 'sshd', 'sshpass',
      'docker', 'terraform', 'git', 'jq', 'yaml'],
    keywords: ['ansible', 'configuration management', 'rhce', 'ex294', 'red hat',
      'automation', 'playbook', 'ansible tower', 'awx', 'idempotent',
      'infrastructure automation', 'server management'],
    addable: ['puppet', 'chef', 'saltstack'],
    notSupported: ['windows'],
  },

  // === Monitoring / Observability ===
  'monitoring-lab': {
    label: 'Monitoring Lab — Prometheus, Grafana, Alertmanager',
    category: 'bigdata',
    provides: ['prometheus', 'grafana', 'alertmanager', 'node exporter', 'node_exporter',
      'promql', 'python', 'python3', 'git', 'ssh', 'sshd'],
    keywords: ['monitoring', 'observability', 'prometheus certified', 'pca',
      'sre', 'site reliability', 'alerting', 'metrics', 'dashboards',
      'grafana dashboards', 'cloud native monitoring'],
    addable: ['thanos', 'loki', 'tempo', 'jaeger', 'opentelemetry'],
    notSupported: ['windows', 'gpu'],
  },

  // === Full-Stack Web Dev ===
  'fullstack-lab': {
    label: 'Full-Stack Lab — Node.js, React, Angular, MongoDB, Redis',
    category: 'dev',
    provides: ['nodejs', 'node', 'node.js', 'npm', 'yarn', 'pnpm',
      'react', 'angular', 'angular cli', 'express', 'express.js',
      'mongodb', 'mongo', 'redis', 'nginx',
      'typescript', 'ts-node', 'nodemon', 'pm2',
      'python', 'python3', 'git', 'ssh', 'sshd'],
    keywords: ['mean stack', 'mern stack', 'full stack', 'fullstack',
      'web development', 'frontend', 'backend', 'javascript', 'typescript',
      'react course', 'angular course', 'node course', 'express course',
      'mongodb course', 'web application', 'spa', 'rest api', 'bootcamp'],
    addable: ['vue', 'next.js', 'nuxt', 'postgresql', 'mysql', 'graphql', 'prisma'],
    notSupported: ['gpu'],
  },

  // === Big Data / Streaming Lab Images (the new ones from this feature) ===

  'bigdata-workspace': {
    label: 'Big Data Lab — Kafka, Spark, MySQL, JDK17, Python 3.10',
    category: 'bigdata',
    // IMPORTANT: provides[] should list services/binaries the customer might
    // actually ASK for by name. Do NOT list Python client libraries here
    // (kafka-python, cassandra-driver, pymysql) — those are implementation
    // details and cause false positives via substring matching. If the
    // customer asks for "cassandra", they want the database, not the driver.
    provides: [
      'java', 'jdk', 'jdk17', 'jre',
      'python', 'python3', 'python3.10', 'pip',
      'kafka', 'zookeeper', 'kraft',
      'spark', 'pyspark', 'spark-submit', 'spark-shell',
      'mysql',
      'hadoop',
      'pandas', 'numpy',
      'jupyter', 'jupyterlab',
      'ssh', 'sshd', 'ssh access', 'openssh',  // openssh-server is installed; toggleable via ENABLE_SSH
      'git', 'curl', 'wget', 'vim', 'nano', 'tmux',
      'bash', 'shell', 'cli',
      'ubuntu', 'ubuntu 22.04', 'linux',
    ],
    keywords: [
      'big data', 'streaming', 'data engineering', 'data engineer',
      'etl', 'data pipeline', 'data lake', 'data warehouse',
      'message broker', 'event streaming', 'kafka course', 'spark course',
      'apache spark', 'apache kafka', 'distributed computing',
    ],
    addable: ['flink', 'airflow', 'nifi', 'hive client', 'presto', 'mariadb'],
    notSupported: ['cassandra'],   // explicitly NOT in this image — picks up bigdata-workspace-cassandra instead
  },

  'bigdata-workspace-cassandra': {
    label: 'Big Data Lab — with Cassandra (heavier)',
    category: 'bigdata',
    provides: [
      // everything from bigdata-workspace…
      'java', 'jdk', 'jdk17', 'jre',
      'python', 'python3', 'python3.10', 'pip',
      'kafka', 'zookeeper', 'kraft',
      'spark', 'pyspark', 'spark-submit', 'spark-shell',
      'mysql',
      'hadoop',
      'pandas', 'numpy',
      'jupyter', 'jupyterlab',
      'ssh', 'sshd', 'ssh access', 'openssh',
      'git', 'curl', 'wget', 'vim', 'nano', 'tmux',
      'bash', 'shell', 'cli',
      'ubuntu', 'ubuntu 22.04', 'linux',
      // …PLUS Cassandra (the database, not just the driver)
      'cassandra', 'cqlsh', 'nosql',
    ],
    keywords: [
      'cassandra', 'nosql', 'wide column', 'distributed database',
      'big data', 'streaming', 'data engineering',
    ],
    addable: ['flink', 'airflow', 'scylladb'],
    notSupported: [],
  },

  // === Jupyter / Data Science / ML ===

  'jupyter-scipy': {
    label: 'Jupyter Notebook (Python/Science)',
    category: 'dev',
    provides: [
      'python', 'python3', 'jupyter', 'jupyterlab', 'jupyter notebook',
      'numpy', 'pandas', 'scipy', 'scikit-learn', 'sklearn',
      'matplotlib', 'seaborn', 'plotly',
      'sqlalchemy', 'pip',
    ],
    keywords: [
      'data science', 'machine learning', 'ml fundamentals',
      'python data analysis', 'jupyter', 'pandas course',
      'scikit-learn', 'sklearn', 'eda', 'exploratory data analysis',
    ],
    addable: ['xgboost', 'lightgbm', 'statsmodels', 'spacy', 'nltk'],
    notSupported: ['tensorflow', 'pytorch', 'gpu'],
  },

  'jupyter-tensorflow': {
    label: 'Jupyter + TensorFlow',
    category: 'dev',
    provides: [
      'python', 'python3', 'jupyter', 'jupyterlab',
      'numpy', 'pandas', 'scipy', 'scikit-learn',
      'tensorflow', 'keras', 'tf', 'tf2',
      'matplotlib', 'seaborn',
    ],
    keywords: [
      'deep learning', 'tensorflow', 'keras', 'neural networks',
      'cnn', 'rnn', 'lstm', 'machine learning',
    ],
    addable: ['pytorch', 'transformers', 'huggingface'],
    notSupported: ['gpu'],
  },

  // === Dev Environments ===

  'vscode-kasm': {
    label: 'VS Code (Desktop in Browser)',
    category: 'dev',
    provides: ['vscode', 'visual studio code', 'git', 'curl', 'wget'],
    keywords: ['development', 'ide', 'coding', 'software engineering', 'general dev'],
    addable: ['nodejs', 'python', 'go', 'rust', 'java'],
    notSupported: [],
  },

  'code-server': {
    label: 'VS Code Server (code-server)',
    category: 'dev',
    provides: ['vscode', 'visual studio code', 'git', 'curl', 'wget'],
    keywords: ['development', 'ide', 'web ide', 'remote dev'],
    addable: ['nodejs', 'python', 'go', 'rust', 'java'],
    notSupported: [],
  },

  'terminal': {
    label: 'Terminal Only',
    category: 'app',
    provides: ['bash', 'shell', 'terminal', 'cli'],
    keywords: ['cli', 'command line', 'shell scripting', 'bash basics'],
    addable: ['vim', 'tmux', 'zsh', 'most cli tools'],
    notSupported: ['gui', 'desktop'],
  },

  // === Cybersecurity / Pentesting ===

  'kali-desktop': {
    label: 'Kali Linux Desktop',
    category: 'security',
    provides: [
      'kali', 'kali linux',
      'nmap', 'metasploit', 'msfconsole',
      'burp', 'burpsuite', 'burp suite',
      'wireshark', 'tcpdump',
      'sqlmap', 'aircrack', 'aircrack-ng',
      'hydra', 'john', 'john the ripper', 'hashcat',
      'nikto', 'dirb', 'gobuster', 'ffuf',
      'searchsploit', 'exploitdb',
      'beef', 'ettercap', 'recon-ng',
      'python', 'python3', 'ruby', 'perl',
    ],
    keywords: [
      'penetration testing', 'pentest', 'pen test', 'ethical hacking',
      'security', 'cybersecurity', 'red team', 'offensive security',
      'oscp', 'ceh', 'comptia security+', 'kali',
      'web application security', 'network security',
    ],
    addable: ['custom exploit kits', 'covenant', 'sliver'],
    notSupported: [],
  },

  'kali-xfce': {
    label: 'Kali Linux (XFCE) — Lightweight',
    category: 'security',
    provides: [
      'kali', 'kali linux', 'nmap', 'metasploit', 'wireshark',
      'sqlmap', 'aircrack', 'hydra', 'john', 'nikto',
      'python', 'python3', 'ruby',
    ],
    keywords: [
      'penetration testing', 'pentest', 'ethical hacking', 'security',
      'kali', 'lightweight kali',
    ],
    addable: ['burpsuite'],
    notSupported: [],
  },

  // === Linux Desktops (general purpose) ===

  'ubuntu-xfce': {
    label: 'Ubuntu Desktop (XFCE)',
    category: 'desktop',
    provides: ['ubuntu', 'ubuntu 22.04', 'linux', 'xfce', 'firefox'],
    keywords: ['ubuntu', 'linux fundamentals', 'desktop linux'],
    addable: [
      'java', 'python', 'nodejs', 'docker cli', 'git',
      'mysql client', 'postgresql client', 'most apt packages',
    ],
    notSupported: [],
  },
  'ubuntu-kde': {
    label: 'Ubuntu Desktop (KDE)',
    category: 'desktop',
    provides: ['ubuntu', 'ubuntu 22.04', 'linux', 'kde', 'firefox'],
    keywords: ['ubuntu', 'kde'],
    addable: ['java', 'python', 'nodejs', 'docker cli', 'git'],
    notSupported: [],
  },
  'ubuntu-mate': {
    label: 'Ubuntu Desktop (MATE)',
    category: 'desktop',
    provides: ['ubuntu', 'linux', 'mate'],
    keywords: ['ubuntu', 'mate'],
    addable: ['java', 'python', 'nodejs', 'git'],
    notSupported: [],
  },
  'ubuntu-openbox': {
    label: 'Ubuntu Minimal (Openbox)',
    category: 'desktop',
    provides: ['ubuntu', 'linux', 'minimal'],
    keywords: ['ubuntu minimal', 'lightweight'],
    addable: ['java', 'python', 'nodejs', 'git'],
    notSupported: [],
  },
  'alpine-xfce': {
    label: 'Alpine Desktop (XFCE) — Ultra Light',
    category: 'desktop',
    provides: ['alpine', 'alpine linux', 'linux', 'busybox'],
    keywords: ['alpine', 'lightweight', 'minimal linux'],
    addable: ['most apk packages'],
    notSupported: ['glibc-only software'],
  },
  'fedora-xfce': {
    label: 'Fedora Desktop (XFCE)',
    category: 'desktop',
    provides: ['fedora', 'linux', 'rpm', 'dnf'],
    keywords: ['fedora', 'redhat family'],
    addable: ['java', 'python', 'nodejs', 'git'],
    notSupported: [],
  },
  'arch-xfce': {
    label: 'Arch Linux Desktop (XFCE)',
    category: 'desktop',
    provides: ['arch', 'arch linux', 'linux', 'pacman'],
    keywords: ['arch', 'rolling release'],
    addable: ['most pacman packages'],
    notSupported: [],
  },

  'kasm-desktop': {
    label: 'Kasm Ubuntu Desktop',
    category: 'desktop',
    provides: ['ubuntu', 'linux', 'firefox'],
    keywords: ['ubuntu desktop', 'general purpose'],
    addable: ['most apt packages'],
    notSupported: [],
  },
  'kasm-desktop-deluxe': {
    label: 'Kasm Ubuntu Desktop Deluxe (Dev Tools)',
    category: 'desktop',
    provides: [
      'ubuntu', 'linux', 'git', 'docker', 'docker cli',
      'nodejs', 'python', 'python3', 'java', 'gcc', 'make',
      'firefox', 'chromium',
    ],
    keywords: [
      'development', 'dev tools', 'general dev', 'software engineering',
      'devops basics', 'docker fundamentals',
    ],
    addable: ['kubectl', 'helm', 'terraform', 'ansible'],
    notSupported: [],
  },

  // === RHEL Family ===

  'rocky-9': {
    label: 'Rocky Linux 9 Desktop (RHEL)',
    category: 'desktop',
    provides: ['rocky', 'rocky linux', 'rhel', 'red hat', 'linux', 'rpm', 'dnf', 'systemctl'],
    keywords: ['rhel', 'red hat', 'rocky', 'rhcsa', 'rhce', 'enterprise linux'],
    addable: ['java', 'python', 'nodejs'],
    notSupported: [],
  },
  'alma-9': {
    label: 'AlmaLinux 9 Desktop (RHEL)',
    category: 'desktop',
    provides: ['alma', 'almalinux', 'rhel', 'red hat', 'linux', 'rpm', 'dnf'],
    keywords: ['rhel', 'red hat', 'alma', 'enterprise linux'],
    addable: ['java', 'python', 'nodejs'],
    notSupported: [],
  },
  'oracle-8': {
    label: 'Oracle Linux 8 Desktop',
    category: 'desktop',
    provides: ['oracle linux', 'rhel', 'red hat', 'linux', 'rpm', 'dnf'],
    keywords: ['oracle linux', 'rhel', 'enterprise linux'],
    addable: ['java', 'python', 'nodejs'],
    notSupported: [],
  },

  // === Single-app images (rarely useful for stack courses but listed for completeness) ===

  'chrome': {
    label: 'Google Chrome Browser',
    category: 'app',
    provides: ['chrome', 'browser'],
    keywords: ['browser', 'chrome'],
    addable: [],
    notSupported: ['everything else'],
  },
  'firefox': {
    label: 'Firefox Browser',
    category: 'app',
    provides: ['firefox', 'browser'],
    keywords: ['browser', 'firefox'],
    addable: [],
    notSupported: ['everything else'],
  },
  'libreoffice': {
    label: 'LibreOffice Suite',
    category: 'app',
    provides: ['libreoffice', 'office', 'spreadsheet', 'word processor'],
    keywords: ['office', 'spreadsheet', 'document'],
    addable: [],
    notSupported: [],
  },
};

/**
 * Words to strip from a software name before matching, to handle the
 * customer typing "Apache Kafka 3.7.0" or "MySQL 8.0 Server" etc.
 */
const STRIP_TOKENS = [
  'apache', 'the', 'server', 'database', 'db', 'cli', 'client',
  'software', 'package', 'binary', 'binaries', 'latest', 'jdk', 'sdk',
];

/**
 * Normalize a single software name for matching:
 *   "Apache Kafka 3.7.0" → "kafka"
 *   "MySQL 8.0 Server" → "mysql"
 *   "Python 3.10+" → "python"
 *   "Java (JDK 17)" → "java"
 */
function normalizeSoftware(name) {
  if (!name) return '';
  let s = String(name).toLowerCase();
  // Strip parens content
  s = s.replace(/\([^)]*\)/g, ' ');
  // Strip version numbers (1.2.3, 1.x, v3, etc.)
  s = s.replace(/\b\d+(\.\d+)*[+x]?\b/g, ' ');
  s = s.replace(/\bv\d+\b/g, ' ');
  // Strip noise words
  for (const t of STRIP_TOKENS) {
    s = s.replace(new RegExp(`\\b${t}\\b`, 'g'), ' ');
  }
  // Collapse whitespace
  s = s.replace(/[^a-z0-9\-_ ]/g, ' ').replace(/\s+/g, ' ').trim();
  return s;
}

/**
 * Pre-split a raw software entry on common separators (slash, comma, " and ",
 * " or ") into multiple sub-items, each then normalized. So:
 *   "MySQL/Cassandra binaries" → ["mysql", "cassandra"]
 *   "Java and Python" → ["java", "python"]
 *   "Spark, Kafka, Hadoop" → ["spark", "kafka", "hadoop"]
 */
function splitAndNormalize(raw) {
  if (!raw) return [];
  // Replace common separators with a single delimiter we can split on
  const split = String(raw).split(/[\/,]|\s+(?:and|or)\s+/i);
  return split.map(normalizeSoftware).filter(Boolean);
}

module.exports = { IMAGE_CAPABILITIES, normalizeSoftware, splitAndNormalize, STRIP_TOKENS };
