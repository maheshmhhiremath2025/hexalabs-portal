require('dotenv').config();
const mongoose = require('mongoose');
const GuidedLab = require('../models/guidedLab');

(async () => {
  await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/userdb');

  await GuidedLab.deleteMany({});
  // Use create() instead of insertMany() to ensure Mongoose generates _id for subdocuments (steps)
  await GuidedLab.create([
    {
      title: 'Deploy Your First Azure VM', slug: 'azure-first-vm', cloud: 'azure', difficulty: 'beginner', duration: 30,
      description: 'Learn how to create a virtual machine in Azure from scratch.',
      category: 'Compute', tags: ['vm', 'linux', 'beginner'], icon: '🖥️', requiresSandbox: true, minTier: 'free',
      vmTemplateName: 'ubuntu-22',
      sandboxConfig: { ttlHours: 2, budgetInr: 200 },
      steps: [
        { order: 1, title: 'Open Azure Portal', description: 'Navigate to the Azure Portal using the link provided. Sign in with your sandbox credentials.', verifyType: 'manual' },
        { order: 2, title: 'Navigate to Virtual Machines', description: 'In the search bar, type Virtual Machines and click on the service. Click + Create > Azure Virtual Machine.', verifyType: 'manual' },
        { order: 3, title: 'Configure Basic Settings', description: 'Select your sandbox resource group. Choose Standard_B1s as the VM size. Select Ubuntu Server 22.04 LTS as the image.', hint: 'Only B-series VMs are allowed in sandbox', verifyType: 'manual' },
        { order: 4, title: 'Configure Networking', description: 'Leave default networking settings. Ensure SSH (22) is allowed in inbound ports.', verifyType: 'manual' },
        { order: 5, title: 'Review and Create', description: 'Click Review + Create. Verify settings and click Create. Wait for deployment (1-2 minutes).', verifyType: 'manual' },
        { order: 6, title: 'Connect to Your VM', description: 'Go to the VM resource. Copy the Public IP. Open terminal and SSH in. Congratulations!', verifyType: 'manual' },
      ],
    },
    {
      title: 'Create an S3 Bucket in AWS', slug: 'aws-s3-bucket', cloud: 'aws', difficulty: 'beginner', duration: 20,
      description: 'Learn how to create an S3 bucket, upload files, and configure permissions in AWS.',
      category: 'Storage', tags: ['s3', 'storage', 'beginner'], icon: '🪣', requiresSandbox: true, minTier: 'free',
      sandboxConfig: { ttlHours: 1, budgetInr: 100 },
      steps: [
        { order: 1, title: 'Open AWS Console', description: 'Navigate to the AWS Console. Sign in with your sandbox IAM credentials.', verifyType: 'manual' },
        { order: 2, title: 'Navigate to S3', description: 'Search for S3 in the search bar and click on the service.', verifyType: 'manual' },
        { order: 3, title: 'Create a Bucket', description: 'Click Create Bucket. Enter a unique bucket name. Select ap-south-1 region. Click Create bucket.', verifyType: 'manual' },
        { order: 4, title: 'Upload a File', description: 'Click on your bucket. Click Upload > Add files. Select any file and upload it.', verifyType: 'manual' },
        { order: 5, title: 'Explore Properties', description: 'Click on your file. Explore Properties and Permissions tabs. Try generating a presigned URL.', verifyType: 'manual' },
      ],
    },
    {
      title: 'Launch a GCP Compute Instance', slug: 'gcp-compute-instance', cloud: 'gcp', difficulty: 'beginner', duration: 25,
      description: 'Create your first virtual machine on Google Cloud Platform.',
      category: 'Compute', tags: ['vm', 'compute', 'beginner'], icon: '☁️', requiresSandbox: true, minTier: 'starter',
      sandboxConfig: { ttlHours: 2, budgetInr: 200 },
      steps: [
        { order: 1, title: 'Open GCP Console', description: 'Navigate to the GCP Console. Select your sandbox project.', verifyType: 'manual' },
        { order: 2, title: 'Navigate to Compute Engine', description: 'Go to Compute Engine > VM Instances. Click Create Instance.', verifyType: 'manual' },
        { order: 3, title: 'Configure the Instance', description: 'Name: my-first-vm. Region: asia-south1. Machine type: e2-micro. Boot disk: Debian 11. Click Create.', hint: 'Only e2/f1/g1 types allowed', verifyType: 'manual' },
        { order: 4, title: 'Connect via SSH', description: 'Click the SSH button to open terminal in browser. Run hostname to verify.', verifyType: 'manual' },
      ],
    },
    {
      title: 'Linux Desktop in Browser', slug: 'container-linux-desktop', cloud: 'container', difficulty: 'beginner', duration: 5,
      description: 'Deploy a full Ubuntu desktop accessible from your browser in seconds.',
      category: 'Containers', tags: ['docker', 'ubuntu', 'beginner'], icon: '🐧', requiresSandbox: false, minTier: 'free',
      containerImage: 'ubuntu-xfce',
      containerConfig: { cpus: 2, memory: 2048 },
      steps: [
        { order: 1, title: 'Deploy Container', description: 'Go to the Containers tab and click Deploy with Ubuntu XFCE selected.', verifyType: 'manual' },
        { order: 2, title: 'Open Desktop', description: 'Click Open to launch the desktop in a new tab.', verifyType: 'manual' },
        { order: 3, title: 'Explore', description: 'Open terminal. Run uname -a. Try installing software with sudo apt install htop.', verifyType: 'manual' },
      ],
    },
    {
      title: 'Kali Linux Security Lab', slug: 'kali-pentest-lab', cloud: 'container', difficulty: 'intermediate', duration: 90,
      description: 'Complete hands-on penetration testing lab using Kali Linux. Learn network scanning with Nmap, vulnerability analysis, web application testing with Nikto and Dirb, password cracking with Hydra and John the Ripper, exploitation with Metasploit, and report generation — all inside a browser-accessible Kali desktop.',
      category: 'Security', tags: ['kali', 'security', 'pentest', 'nmap', 'metasploit', 'intermediate'], icon: '🔒', requiresSandbox: false, minTier: 'starter',
      containerImage: 'kali-desktop',
      containerConfig: { cpus: 2, memory: 4096 },
      labTroubleshooting: [
        { issue: 'Tools not found or command not recognized', solution: 'Run: sudo apt update && sudo apt install -y kali-tools-top10 to install all top 10 tools. Some tools may need manual install: sudo apt install <tool-name>', category: 'Software' },
        { issue: 'Permission denied when running tools', solution: 'Most security tools require root privileges. Use sudo before commands, or switch to root: sudo su', category: 'Permissions' },
        { issue: 'Nmap scan shows all ports filtered or no results', solution: 'You are scanning inside a container — try scanning localhost (127.0.0.1) or use the --unprivileged flag. Some scan types require root: sudo nmap -sS target', category: 'Connectivity' },
        { issue: 'Metasploit database not connected', solution: 'Initialize the database first: sudo msfdb init && msfconsole. Inside msfconsole run: db_status to verify connection', category: 'Software' },
        { issue: 'Container desktop is slow or unresponsive', solution: 'Close unused browser tabs. If the desktop freezes, try refreshing the browser tab. The container may need more resources for heavy tools like Metasploit.', category: 'Environment' },
        { issue: 'Wordlists not found at expected paths', solution: 'Kali wordlists are at /usr/share/wordlists/. If rockyou.txt is compressed: sudo gunzip /usr/share/wordlists/rockyou.txt.gz', category: 'Software' },
      ],
      steps: [
        {
          order: 1, title: 'Deploy Kali Linux Desktop', verifyType: 'manual',
          description: `## Deploy Your Kali Environment\n\n1. Navigate to the **Containers** tab in the portal\n2. Select **Kali Desktop** from the available images\n3. Click **Deploy** and wait for the container to start (30-60 seconds)\n4. Once running, click **Open** to launch the Kali desktop in your browser\n\nYou now have a fully functional Kali Linux desktop accessible from your browser with all security tools pre-installed.`,
          hint: 'If the container takes too long to deploy, check your network connection and try again. The Kali image is larger than standard Linux images.',
          troubleshooting: [
            { issue: 'Container fails to start', solution: 'Wait 30 seconds and try deploying again. If it persists, delete the old container first and redeploy.' },
            { issue: 'Black screen after opening desktop', solution: 'Wait 10-15 seconds for the desktop environment to fully load. Try refreshing the browser tab.' },
          ],
        },
        {
          order: 2, title: 'Set Up Your Terminal and Update System', verifyType: 'auto',
          verifyCommand: 'which nmap && which msfconsole && echo "TOOLS_READY"',
          verifyExpectedOutput: 'TOOLS_READY',
          description: `## Open Terminal and Verify Tools\n\n1. **Right-click** on the desktop and select **Open Terminal Here**, or click the terminal icon in the taskbar\n2. Update the package lists:\n\n\`\`\`bash\nsudo apt update\n\`\`\`\n\n3. Verify essential tools are installed:\n\n\`\`\`bash\n# Check Nmap\nnmap --version\n\n# Check Metasploit\nmsfconsole --version\n\n# Check Nikto\nnikto -Version\n\n# Check Hydra\nhydra -h | head -5\n\n# Check John the Ripper\njohn --help | head -3\n\`\`\`\n\n4. If any tool is missing, install it:\n\n\`\`\`bash\nsudo apt install -y nmap metasploit-framework nikto hydra john dirb\n\`\`\``,
          hint: 'All Kali tools come pre-installed in the container. If a specific tool is missing, use: sudo apt install <tool-name>',
          troubleshooting: [
            { issue: 'apt update fails with network error', solution: 'The container may not have internet access. Try: sudo dhclient to renew network, or check if DNS is configured: cat /etc/resolv.conf' },
            { issue: 'msfconsole not found', solution: 'Install Metasploit: sudo apt install -y metasploit-framework. Then run: sudo msfdb init to initialize the database.' },
          ],
        },
        {
          order: 3, title: 'Network Reconnaissance with Nmap — Basic Scanning', verifyType: 'auto',
          verifyCommand: 'nmap -sT -p 22,80,443 localhost 2>/dev/null | grep -c "open\\|closed\\|filtered" && echo "SCAN_OK"',
          verifyExpectedOutput: 'SCAN_OK',
          description: `## Network Scanning Fundamentals\n\nNmap (Network Mapper) is the most important reconnaissance tool. Learn different scan types:\n\n### 1. Basic TCP Connect Scan\n\n\`\`\`bash\n# Scan localhost for common ports\nnmap -sT localhost\n\`\`\`\n\n### 2. Service Version Detection\n\n\`\`\`bash\n# Detect service versions running on open ports\nnmap -sV localhost\n\`\`\`\n\n### 3. Specific Port Range Scan\n\n\`\`\`bash\n# Scan specific ports\nnmap -p 22,80,443,8080 localhost\n\n# Scan a range\nnmap -p 1-1000 localhost\n\`\`\`\n\n### 4. OS Detection\n\n\`\`\`bash\n# Detect operating system (requires root)\nsudo nmap -O localhost\n\`\`\`\n\n### 5. Save Results\n\n\`\`\`bash\n# Save scan results to a file\nnmap -sV -oN ~/nmap_scan_results.txt localhost\n\n# View the saved results\ncat ~/nmap_scan_results.txt\n\`\`\`\n\n**Important:** In real pentests, always get written authorization before scanning any network.`,
          hint: 'Use -sT for TCP connect scan (no root needed), -sS for SYN stealth scan (needs root). Add -v for verbose output to see scan progress.',
          troubleshooting: [
            { issue: 'Scan returns "0 hosts up"', solution: 'Use -Pn flag to skip host discovery: nmap -Pn -sT localhost' },
            { issue: 'Permission denied for SYN scan', solution: 'SYN scans require root: sudo nmap -sS localhost. Use -sT for unprivileged scans.' },
          ],
        },
        {
          order: 4, title: 'Advanced Nmap — Scripts and Vulnerability Scanning', verifyType: 'auto',
          verifyCommand: 'ls /usr/share/nmap/scripts/ | wc -l | xargs -I {} test {} -gt 50 && echo "NSE_SCRIPTS_AVAILABLE"',
          verifyExpectedOutput: 'NSE_SCRIPTS_AVAILABLE',
          description: `## Nmap Scripting Engine (NSE)\n\nNmap includes 600+ scripts for vulnerability detection, brute force, and more.\n\n### 1. List Available Scripts\n\n\`\`\`bash\n# See all available scripts\nls /usr/share/nmap/scripts/ | head -30\n\n# Count total scripts\nls /usr/share/nmap/scripts/ | wc -l\n\n# Search for specific scripts\nls /usr/share/nmap/scripts/ | grep -i "vuln"\n\`\`\`\n\n### 2. Run Default Scripts\n\n\`\`\`bash\n# -sC runs default safe scripts\nnmap -sC -sV localhost\n\`\`\`\n\n### 3. Run Vulnerability Scripts\n\n\`\`\`bash\n# Run all vuln category scripts\nnmap --script=vuln localhost\n\`\`\`\n\n### 4. Run Specific Scripts\n\n\`\`\`bash\n# HTTP enumeration\nnmap --script=http-enum -p 80 localhost\n\n# SSL/TLS analysis\nnmap --script=ssl-enum-ciphers -p 443 localhost\n\n# Banner grabbing\nnmap --script=banner -p 1-1000 localhost\n\`\`\`\n\n### 5. Aggressive Scan (combines OS detection, version, scripts, traceroute)\n\n\`\`\`bash\nsudo nmap -A localhost -oN ~/nmap_aggressive.txt\ncat ~/nmap_aggressive.txt\n\`\`\``,
          hint: 'NSE scripts are categorized: auth, broadcast, brute, default, discovery, dos, exploit, external, fuzzer, intrusive, malware, safe, version, vuln',
          troubleshooting: [
            { issue: 'Script scan takes too long', solution: 'Limit to specific ports: nmap --script=vuln -p 80,443 localhost. Or set timeout: nmap --script-timeout 30 --script=vuln localhost' },
            { issue: 'Scripts folder is empty or missing', solution: 'Update Nmap scripts: sudo nmap --script-updatedb' },
          ],
        },
        {
          order: 5, title: 'Web Application Scanning with Nikto', verifyType: 'manual',
          description: `## Web Vulnerability Scanner\n\nNikto scans web servers for dangerous files, outdated software, and configuration issues.\n\n### 1. Start a Simple Web Server (for testing)\n\n\`\`\`bash\n# Create a test web directory\nmkdir -p ~/webtest && echo "<h1>Test Page</h1>" > ~/webtest/index.html\n\n# Start a Python web server in background\ncd ~/webtest && python3 -m http.server 8080 &\n\n# Verify it's running\ncurl http://localhost:8080\n\`\`\`\n\n### 2. Run Nikto Against the Server\n\n\`\`\`bash\n# Basic scan\nnikto -h http://localhost:8080\n\`\`\`\n\n### 3. Save Nikto Results\n\n\`\`\`bash\n# Save as HTML report\nnikto -h http://localhost:8080 -o ~/nikto_report.html -Format html\n\n# Save as text\nnikto -h http://localhost:8080 -o ~/nikto_report.txt\n\`\`\`\n\n### 4. Directory Bruteforcing with Dirb\n\n\`\`\`bash\n# Discover hidden directories\ndirb http://localhost:8080 /usr/share/dirb/wordlists/common.txt\n\`\`\`\n\n### 5. Clean Up — Stop the Web Server\n\n\`\`\`bash\nkill %1  # Stop the background web server\n\`\`\``,
          hint: 'Nikto uses -h for host, -p for port, -o for output file. Use -Tuning to select test types: -Tuning 1 for interesting files, 2 for misconfigurations.',
          troubleshooting: [
            { issue: 'Nikto shows "0 host(s) tested"', solution: 'Make sure the web server is running: curl http://localhost:8080. If not, restart it: python3 -m http.server 8080 &' },
            { issue: 'Dirb not found', solution: 'Install it: sudo apt install -y dirb' },
            { issue: 'Port 8080 already in use', solution: 'Use a different port: python3 -m http.server 9090 and scan that port instead' },
          ],
        },
        {
          order: 6, title: 'Password Cracking with John the Ripper', verifyType: 'auto',
          verifyCommand: 'test -f /usr/share/wordlists/rockyou.txt && echo "WORDLIST_READY" || (test -f /usr/share/wordlists/rockyou.txt.gz && echo "WORDLIST_COMPRESSED")',
          verifyExpectedOutput: 'WORDLIST_READY|WORDLIST_COMPRESSED',
          description: `## Offline Password Cracking\n\nJohn the Ripper is the most popular password cracking tool.\n\n### 1. Prepare Wordlists\n\n\`\`\`bash\n# Decompress the famous rockyou wordlist\nsudo gunzip /usr/share/wordlists/rockyou.txt.gz 2>/dev/null\n\n# Check wordlist size\nwc -l /usr/share/wordlists/rockyou.txt\n\n# View first 20 passwords\nhead -20 /usr/share/wordlists/rockyou.txt\n\`\`\`\n\n### 2. Create Sample Password Hashes\n\n\`\`\`bash\n# Create a file with MD5 hashes to crack\necho -n "password123" | md5sum | awk '{print "user1:"$1}' > ~/hashes.txt\necho -n "admin" | md5sum | awk '{print "user2:"$1}' >> ~/hashes.txt\necho -n "letmein" | md5sum | awk '{print "user3:"$1}' >> ~/hashes.txt\n\ncat ~/hashes.txt\n\`\`\`\n\n### 3. Crack with John\n\n\`\`\`bash\n# Crack the hashes using rockyou wordlist\njohn --format=raw-md5 --wordlist=/usr/share/wordlists/rockyou.txt ~/hashes.txt\n\n# Show cracked passwords\njohn --show --format=raw-md5 ~/hashes.txt\n\`\`\`\n\n### 4. Crack Linux Shadow Passwords\n\n\`\`\`bash\n# Combine passwd and shadow files (requires root)\nsudo unshadow /etc/passwd /etc/shadow > ~/unshadowed.txt\n\n# Attempt to crack\njohn --wordlist=/usr/share/wordlists/rockyou.txt ~/unshadowed.txt\n\n# Check results\njohn --show ~/unshadowed.txt\n\`\`\`\n\n### 5. Hash Identification\n\n\`\`\`bash\n# Identify hash type\nhash-identifier\n# Paste a hash when prompted, press Ctrl+C to exit\n\`\`\``,
          hint: 'John auto-detects hash types, but you can specify with --format=. Common formats: raw-md5, raw-sha1, raw-sha256, bcrypt',
          troubleshooting: [
            { issue: 'rockyou.txt not found', solution: 'It may be compressed: sudo gunzip /usr/share/wordlists/rockyou.txt.gz. Or download: sudo apt install -y wordlists' },
            { issue: 'John shows "No password hashes loaded"', solution: 'Specify the hash format explicitly: john --format=raw-md5 hashes.txt. Check your hash file format is correct.' },
            { issue: 'Cracking is very slow', solution: 'Use a smaller wordlist first: john --wordlist=/usr/share/wordlists/dirb/common.txt hashes.txt' },
          ],
        },
        {
          order: 7, title: 'Network Password Attack with Hydra', verifyType: 'manual',
          description: `## Online Password Brute-Forcing\n\nHydra is a fast online password cracker supporting many protocols (SSH, FTP, HTTP, etc.).\n\n### 1. Check Hydra Capabilities\n\n\`\`\`bash\n# List all supported protocols\nhydra -h | grep "Supported services"\n\n# Check version\nhydra -V\n\`\`\`\n\n### 2. Create a Small Custom Wordlist\n\n\`\`\`bash\n# Create usernames list\ncat > ~/users.txt << 'EOF'\nadmin\nroot\nuser\ntest\nguest\nEOF\n\n# Create passwords list\ncat > ~/passwords.txt << 'EOF'\npassword\nadmin\n123456\nroot\npassword123\nletmein\nqwerty\nEOF\n\`\`\`\n\n### 3. SSH Brute Force (against localhost)\n\n\`\`\`bash\n# Start SSH service first\nsudo service ssh start\n\n# Run Hydra against SSH (this is for demo — will test all combos)\nhydra -L ~/users.txt -P ~/passwords.txt localhost ssh -t 4 -V\n\`\`\`\n\n### 4. HTTP Form Brute Force (demo syntax)\n\n\`\`\`bash\n# Example syntax for HTTP POST login form\n# hydra -L users.txt -P passwords.txt target http-post-form \\\n#   "/login:username=^USER^&password=^PASS^:Invalid credentials"\n\n# View Hydra help for HTTP forms\nhydra -U http-post-form\n\`\`\`\n\n### 5. Understanding Results\n\n\`\`\`bash\n# Hydra output shows:\n# [22][ssh] host: localhost   login: root   password: found_password\n# Green text = successful credential found\n\`\`\`\n\n**Warning:** Only use Hydra against systems you own or have explicit authorization to test.`,
          hint: 'Use -t to control threads (default 16, reduce for stealth). Use -V for verbose output to see each attempt. Use -f to stop on first found credential.',
          troubleshooting: [
            { issue: 'Connection refused on SSH', solution: 'Start SSH service: sudo service ssh start. Verify: sudo service ssh status' },
            { issue: 'Hydra is too slow', solution: 'Increase threads: hydra -t 8 ... Or use a smaller wordlist for testing' },
            { issue: 'Too many false positives', solution: 'Check if the service is actually running and accepting login attempts. Some services may respond differently than expected.' },
          ],
        },
        {
          order: 8, title: 'Initialize and Explore Metasploit Framework', verifyType: 'auto',
          verifyCommand: 'sudo msfdb init 2>/dev/null; msfconsole -qx "version; exit" 2>/dev/null | grep -c "Framework" && echo "MSF_OK"',
          verifyExpectedOutput: 'MSF_OK',
          description: `## The Metasploit Framework\n\nMetasploit is the world\'s most used penetration testing framework.\n\n### 1. Initialize the Database\n\n\`\`\`bash\n# Initialize Metasploit database (required for first use)\nsudo msfdb init\n\n# Check database status\nsudo msfdb status\n\`\`\`\n\n### 2. Launch Metasploit Console\n\n\`\`\`bash\n# Start msfconsole\nmsfconsole\n\`\`\`\n\n### 3. Explore Inside msfconsole\n\n\`\`\`\n# Check version and stats\nmsf6 > version\nmsf6 > banner\n\n# Check database connection\nmsf6 > db_status\n\n# See all available commands\nmsf6 > help\n\n# Count available exploits, payloads, etc.\nmsf6 > show exploits | wc -l\nmsf6 > show payloads | wc -l\nmsf6 > show auxiliary | wc -l\n\`\`\`\n\n### 4. Search for Modules\n\n\`\`\`\n# Search for SSH-related modules\nmsf6 > search ssh\n\n# Search for specific CVEs\nmsf6 > search cve:2021\n\n# Search by type\nmsf6 > search type:exploit platform:linux\n\`\`\`\n\n### 5. Explore a Module (without running it)\n\n\`\`\`\n# Select a module\nmsf6 > use auxiliary/scanner/ssh/ssh_version\n\n# View module info\nmsf6 auxiliary(scanner/ssh/ssh_version) > info\n\n# View required options\nmsf6 auxiliary(scanner/ssh/ssh_version) > show options\n\n# Set target\nmsf6 auxiliary(scanner/ssh/ssh_version) > set RHOSTS 127.0.0.1\n\n# Run the module\nmsf6 auxiliary(scanner/ssh/ssh_version) > run\n\n# Go back to main menu\nmsf6 auxiliary(scanner/ssh/ssh_version) > back\n\`\`\`\n\n### 6. Exit Metasploit\n\n\`\`\`\nmsf6 > exit\n\`\`\``,
          hint: 'Use msfconsole -q for quiet mode (no banner). Use Tab key for auto-complete. Use search keyword to find modules. Use info <module> to learn about any module.',
          troubleshooting: [
            { issue: 'msfconsole takes very long to start', solution: 'First launch is slow (30-60s) as it loads modules. Use -q flag to skip the banner: msfconsole -q' },
            { issue: 'Database not connected', solution: 'Run: sudo msfdb reinit to reinitialize. Then start msfconsole again.' },
            { issue: 'Module not found', solution: 'Update Metasploit: sudo apt update && sudo apt install -y metasploit-framework' },
          ],
        },
        {
          order: 9, title: 'Metasploit — Port Scanning and Service Detection', verifyType: 'manual',
          description: `## Using Metasploit for Scanning\n\nMetasploit has built-in scanning modules that integrate with its database.\n\n### 1. Import Nmap Results into Metasploit\n\n\`\`\`bash\n# First, run an Nmap scan with XML output\nnmap -sV -oX ~/nmap_results.xml localhost\n\`\`\`\n\n### 2. Inside msfconsole, Import and Use Results\n\n\`\`\`\nmsfconsole -q\n\n# Import Nmap results\nmsf6 > db_import ~/nmap_results.xml\n\n# View discovered hosts\nmsf6 > hosts\n\n# View discovered services\nmsf6 > services\n\n# View vulnerabilities (after vuln scans)\nmsf6 > vulns\n\`\`\`\n\n### 3. Run Metasploit's Own Port Scanner\n\n\`\`\`\n# Use TCP port scanner\nmsf6 > use auxiliary/scanner/portscan/tcp\nmsf6 auxiliary(scanner/portscan/tcp) > set RHOSTS 127.0.0.1\nmsf6 auxiliary(scanner/portscan/tcp) > set PORTS 1-1000\nmsf6 auxiliary(scanner/portscan/tcp) > set THREADS 10\nmsf6 auxiliary(scanner/portscan/tcp) > run\n\`\`\`\n\n### 4. Run SSH Version Scanner\n\n\`\`\`\nmsf6 > use auxiliary/scanner/ssh/ssh_version\nmsf6 auxiliary(scanner/ssh/ssh_version) > set RHOSTS 127.0.0.1\nmsf6 auxiliary(scanner/ssh/ssh_version) > run\nmsf6 auxiliary(scanner/ssh/ssh_version) > back\n\`\`\`\n\n### 5. Check All Collected Data\n\n\`\`\`\nmsf6 > hosts -c address,os_name,os_flavor\nmsf6 > services -c port,proto,name,info\nmsf6 > exit\n\`\`\``,
          hint: 'The Metasploit database stores all scan results. Use hosts, services, vulns, and creds commands to review data collected across all modules you run.',
          troubleshooting: [
            { issue: 'db_import fails', solution: 'Make sure the database is initialized: sudo msfdb init. Restart msfconsole and try again.' },
            { issue: 'Port scanner seems stuck', solution: 'Reduce thread count: set THREADS 4. Reduce port range: set PORTS 1-100' },
          ],
        },
        {
          order: 10, title: 'Wireless & Network Tools Overview', verifyType: 'manual',
          description: `## Network Analysis Tools in Kali\n\nExplore additional network security tools available in Kali.\n\n### 1. Wireshark (Packet Capture)\n\n\`\`\`bash\n# Start Wireshark GUI\nwireshark &\n\n# Or use tshark (CLI version) to capture packets\nsudo tshark -i eth0 -c 20\n\n# Capture only HTTP traffic\nsudo tshark -i eth0 -f "port 80" -c 10\n\`\`\`\n\n### 2. Tcpdump (Command-line Packet Capture)\n\n\`\`\`bash\n# Capture 10 packets\nsudo tcpdump -i eth0 -c 10\n\n# Capture and save to file\nsudo tcpdump -i eth0 -c 50 -w ~/capture.pcap\n\n# Read captured file\nsudo tcpdump -r ~/capture.pcap\n\`\`\`\n\n### 3. Netcat (Swiss Army Knife of Networking)\n\n\`\`\`bash\n# Start a listener on port 4444\nnc -lvp 4444 &\n\n# Connect to the listener\necho "Hello from Kali!" | nc localhost 4444\n\n# Port scanning with netcat\nnc -zv localhost 20-100 2>&1 | grep "succeeded"\n\`\`\`\n\n### 4. ARP Scanning\n\n\`\`\`bash\n# Discover hosts on the local network\narp-scan --localnet 2>/dev/null || echo "Run: sudo apt install arp-scan"\n\n# Alternative: Nmap ping sweep\nnmap -sn 172.17.0.0/24\n\`\`\`\n\n### 5. DNS Enumeration\n\n\`\`\`bash\n# DNS lookup\nnslookup google.com\n\n# Detailed DNS info\ndig google.com ANY\n\n# Reverse DNS\nhost 8.8.8.8\n\`\`\``,
          hint: 'Use tshark instead of Wireshark if you prefer command line. Tcpdump is lighter and available on almost all Linux systems.',
          troubleshooting: [
            { issue: 'Wireshark shows no interfaces', solution: 'Run with sudo: sudo wireshark &. Or use tshark: sudo tshark -D to list interfaces.' },
            { issue: 'tcpdump permission denied', solution: 'Must run as root: sudo tcpdump -i eth0' },
          ],
        },
        {
          order: 11, title: 'Compile Your Penetration Test Report', verifyType: 'auto',
          verifyCommand: 'test -f ~/pentest_report.md && wc -l ~/pentest_report.md | awk "{if(\\$1 > 5) print \\"REPORT_CREATED\\"}"',
          verifyExpectedOutput: 'REPORT_CREATED',
          description: `## Create a Professional Report\n\nEvery pentest ends with a report. Document your findings.\n\n### 1. Create Report File\n\n\`\`\`bash\ncat > ~/pentest_report.md << 'REPORT'\n# Penetration Test Report\n## Target: Kali Linux Lab (localhost)\n## Date: $(date +%Y-%m-%d)\n## Tester: Lab Student\n\n---\n\n## Executive Summary\nThis penetration test was conducted against the lab environment to practice\nsecurity assessment techniques.\n\n## Scope\n- Target: 127.0.0.1 (localhost)\n- Tools Used: Nmap, Nikto, Hydra, John the Ripper, Metasploit\n- Duration: Lab session\n\n## Findings\n\n### 1. Open Ports & Services\n- See: ~/nmap_scan_results.txt\n- Services detected: [list from your scan]\n\n### 2. Web Server Vulnerabilities\n- See: ~/nikto_report.txt\n- Findings: [summarize Nikto findings]\n\n### 3. Password Weaknesses\n- Cracked hashes: [results from John]\n- Weak credentials found: [results from Hydra]\n\n### 4. Metasploit Results\n- Modules tested: ssh_version\n- Vulnerabilities found: [list any]\n\n## Recommendations\n1. Close unnecessary open ports\n2. Update all services to latest versions\n3. Enforce strong password policies\n4. Enable firewall rules\n5. Implement intrusion detection\n\n## Appendix\n- Nmap results: ~/nmap_scan_results.txt\n- Nikto report: ~/nikto_report.txt\n- Nmap aggressive scan: ~/nmap_aggressive.txt\nREPORT\n\`\`\`\n\n### 2. View Your Report\n\n\`\`\`bash\ncat ~/pentest_report.md\n\`\`\`\n\n### 3. Collect All Evidence Files\n\n\`\`\`bash\n# List all generated files\nls -la ~/nmap_*.txt ~/nikto_*.txt ~/pentest_report.md ~/hashes.txt 2>/dev/null\n\`\`\`\n\nCongratulations! You\'ve completed a full penetration testing workflow:  Reconnaissance → Scanning → Enumeration → Exploitation → Reporting`,
          hint: 'A real pentest report includes: Executive Summary, Methodology, Findings with severity ratings (Critical/High/Medium/Low), Evidence (screenshots/logs), and Remediation recommendations.',
          troubleshooting: [
            { issue: 'cat heredoc fails', solution: 'Make sure you copy the entire command including the closing REPORT line. Or create the file manually using nano ~/pentest_report.md' },
            { issue: 'Some scan files are missing', solution: 'That\'s okay — the report template lists expected files. Just note which scans you completed.' },
          ],
        },
      ],
    },
    {
      title: 'Azure Networking: VNet and Subnets', slug: 'azure-networking', cloud: 'azure', difficulty: 'intermediate', duration: 40,
      description: 'Create a virtual network with subnets and configure NSGs.',
      category: 'Networking', tags: ['vnet', 'networking', 'intermediate'], icon: '🌐', requiresSandbox: true, minTier: 'starter',
      vmTemplateName: 'ubuntu-22',
      sandboxConfig: { ttlHours: 2, budgetInr: 200 },
      steps: [
        { order: 1, title: 'Create a Virtual Network', description: 'Go to Virtual Networks > Create. Name: lab-vnet. Address: 10.0.0.0/16. Add web-subnet and db-subnet.', verifyType: 'manual' },
        { order: 2, title: 'Create NSG', description: 'Create web-nsg. Add rules: Allow HTTP(80), HTTPS(443), SSH(22). Deny all other.', verifyType: 'manual' },
        { order: 3, title: 'Associate NSG', description: 'Associate web-nsg with the web-subnet.', verifyType: 'manual' },
        { order: 4, title: 'Deploy VMs', description: 'Create a B1s VM in each subnet. Verify connectivity follows NSG rules.', verifyType: 'manual' },
      ],
    },
    {
      title: 'VS Code in the Cloud', slug: 'vscode-cloud', cloud: 'container', difficulty: 'beginner', duration: 10,
      description: 'Run Visual Studio Code in your browser with full extension support.',
      category: 'Development', tags: ['vscode', 'dev', 'beginner'], icon: '💻', requiresSandbox: false, minTier: 'free',
      containerImage: 'vscode-kasm',
      containerConfig: { cpus: 2, memory: 2048 },
      steps: [
        { order: 1, title: 'Deploy VS Code', description: 'Deploy a VS Code (Desktop in Browser) container.', verifyType: 'manual' },
        { order: 2, title: 'Open Editor', description: 'Click Open. VS Code opens in your browser with full functionality.', verifyType: 'manual' },
        { order: 3, title: 'Create a Project', description: 'Open terminal (Ctrl+`). Create a folder: mkdir myproject && cd myproject. Create a file: code index.html', verifyType: 'manual' },
        { order: 4, title: 'Install Extensions', description: 'Click the Extensions icon. Search and install Python or any extension.', verifyType: 'manual' },
      ],
    },
    {
      title: 'AWS IAM: Users and Policies', slug: 'aws-iam', cloud: 'aws', difficulty: 'intermediate', duration: 35,
      description: 'Learn how IAM works — create users, groups, and attach policies.',
      category: 'Security', tags: ['iam', 'security', 'intermediate'], icon: '🔐', requiresSandbox: true, minTier: 'starter',
      sandboxConfig: { ttlHours: 2, budgetInr: 100 },
      steps: [
        { order: 1, title: 'Navigate to IAM', description: 'Go to IAM service in AWS Console.', verifyType: 'manual' },
        { order: 2, title: 'Create a User', description: 'Create a new IAM user with programmatic access.', verifyType: 'manual' },
        { order: 3, title: 'Create a Group', description: 'Create a group called developers. Attach AmazonS3ReadOnlyAccess policy.', verifyType: 'manual' },
        { order: 4, title: 'Add User to Group', description: 'Add your new user to the developers group.', verifyType: 'manual' },
        { order: 5, title: 'Test Permissions', description: 'Sign in as the new user. Verify they can read S3 but not write.', verifyType: 'manual' },
      ],
    },
  ]);
  console.log('Guided labs seeded:', await GuidedLab.countDocuments());
  process.exit(0);
})();
