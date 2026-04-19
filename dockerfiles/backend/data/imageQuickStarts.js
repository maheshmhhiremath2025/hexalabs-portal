// Per-image quick-start content for welcome emails.
// Returns an array of `info`/`steps` sections from emailTemplate.js for
// the given imageKey, OR an empty array if no special content applies.
//
// Adding a new image? Add a case below — keep each block small.
// The renderer in emailTemplate.js handles formatting (HTML + plain text).

const { info, steps } = require('../services/emailTemplate');

function quickStartFor(imageKey, ctx = {}) {
  const key = String(imageKey || '').toLowerCase();
  const password = ctx.accessPassword || ctx.password || '';

  if (key.includes('bigdata')) {
    const cas = key.includes('cassandra');
    return [
      info("What's pre-installed",
        `Ubuntu 22.04 · JDK 17 · Python 3.10 + PySpark · Kafka 3.7 (KRaft, :9092) · Spark 3.5 (UI :8080) · MySQL 8 (:3306, db=labdb, user=lab)${cas ? ' · Cassandra 4.1 (:9042)' : ''} · git/vim/tmux/htop/jq`),
      steps('Verify your environment', [
        { text: 'Check service status', code: 'sudo supervisorctl status' },
        { text: 'Check core versions', code: 'java -version && python3 --version && mysql --version' },
      ]),
      steps('Kafka quick start', [
        { text: 'Create a topic', code: 'kafka-topics.sh --bootstrap-server localhost:9092 --create --topic my-events --partitions 3 --replication-factor 1' },
        { text: 'List topics', code: 'kafka-topics.sh --bootstrap-server localhost:9092 --list' },
        { text: 'Produce messages', code: 'kafka-console-producer.sh --bootstrap-server localhost:9092 --topic my-events' },
        { text: 'Consume (in another terminal)', code: 'kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic my-events --from-beginning' },
      ]),
      steps('Spark quick start', [
        { text: 'PySpark shell', code: 'pyspark' },
        { text: 'Submit a job', code: 'spark-submit --master local[*] your_script.py' },
        { text: 'Spark UI', code: 'open http://localhost:8080' },
      ]),
      steps('MySQL quick start', [
        { text: 'Connect', code: `mysql -ulab -p'${password}' labdb` },
        { text: 'Sample table', code: "CREATE TABLE users (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100));" },
      ]),
      ...(cas ? [steps('Cassandra quick start', [
        { text: 'Open CQL shell', code: 'cqlsh' },
        { text: 'Create keyspace', code: "CREATE KEYSPACE lab WITH replication = {'class':'SimpleStrategy','replication_factor':1};" },
      ])] : []),
      info('Troubleshooting',
        '<ul style="margin:0;padding-left:18px;font-size:12px;line-height:1.7;color:#374151;">' +
        '<li>Restart a service: <code>sudo supervisorctl restart kafka</code></li>' +
        '<li>Tail logs: <code>sudo supervisorctl tail -f kafka</code></li>' +
        '<li>Kafka slow on first start: KRaft needs ~30s</li>' +
        (cas ? '<li>Cassandra takes 60-90s to fully start: <code>nodetool status</code></li>' : '') +
        '<li>Need to extend the lab? Open Lab Console → click "Extend"</li></ul>',
        'amber'),
    ];
  }

  if (key.includes('kali')) {
    return [
      info("What's pre-installed",
        'Kali Linux Rolling · Metasploit · Burp Suite Community · Nmap · Wireshark · sqlmap · john / hashcat · gobuster / dirbuster · ZAP · MSF DB ready'),
      steps('Common workflows', [
        { text: 'Update Metasploit DB', code: 'sudo msfdb init && msfconsole' },
        { text: 'Quick port scan', code: 'nmap -sV -T4 <target>' },
        { text: 'Web app scan', code: 'gobuster dir -u http://<target> -w /usr/share/wordlists/dirb/common.txt' },
      ]),
      info('Lab use only',
        'Only attack systems you own or have written authorization to test. The lab network is isolated from your organization VPN.',
        'amber'),
    ];
  }

  if (key.includes('jupyter')) {
    return [
      info("What's pre-installed",
        'JupyterLab · Python 3 + numpy/pandas/scipy/scikit-learn/matplotlib · TensorFlow / PyTorch (on -tensorflow image)'),
      info('Open the notebook',
        'JupyterLab is on the URL above. Default token = your password. Open a notebook → File → New → Python 3.',
        'blue'),
    ];
  }

  if (key.includes('claude-code')) {
    return [
      info("What's pre-installed",
        'VS Code Server (code-server) · Node.js 20 · Claude Code CLI (run <code>claude</code> in any terminal) · git · curl/wget'),
      steps('First steps', [
        'Open the URL above in your browser. Password is shown in this email.',
        { text: 'Open a terminal in VS Code (Ctrl+`) and try Claude Code', code: 'claude' },
        'Your work persists for the lab duration. Save important code to a git repo.',
      ]),
    ];
  }

  if (key.includes('terraform')) {
    return [
      info("What's pre-installed",
        'Terraform 1.x · AWS CLI · Azure CLI · gcloud · git · vim/nano'),
      steps('Verify CLIs', [
        { text: 'Check Terraform', code: 'terraform version' },
        { text: 'Check AWS', code: 'aws --version' },
        { text: 'Configure your sandbox creds (AWS example)', code: 'aws configure' },
      ]),
    ];
  }

  if (key.includes('docker') || key.includes('k8s') || key.includes('kubernetes')) {
    return [
      info("What's pre-installed",
        'Docker (nested via sysbox) · docker-compose · kubectl · kind · k3s · helm'),
      steps('First steps', [
        { text: 'Verify Docker works inside the lab', code: 'docker run hello-world' },
        { text: 'Spin up a kind cluster', code: 'kind create cluster' },
        { text: 'Try kubectl', code: 'kubectl get nodes' },
      ]),
    ];
  }

  // No image-specific content
  return [];
}

module.exports = { quickStartFor };
