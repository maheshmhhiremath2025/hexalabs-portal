const Handlebars = require('handlebars');
const html_to_pdf = require('html-pdf-node');
const fs = require('fs');
const invoicePath = '/usr/src/app/shared_logs/summary.pdf';

// Register Handlebars helpers for formatting date and calculating totals
Handlebars.registerHelper('formatDate', function (dateString) {
  const date = new Date(dateString);
  
  // Extract date components
  const day = String(date.getDate()).padStart(2, '0'); // Day with leading zero
  const month = String(date.getMonth() + 1).padStart(2, '0'); // Month (0-indexed)
  const year = date.getFullYear(); // Full year

  // Extract time components
  let hours = date.getHours(); // 0-23
  const minutes = String(date.getMinutes()).padStart(2, '0'); // Minutes with leading zero
  const seconds = String(date.getSeconds()).padStart(2, '0'); // Seconds with leading zero

  // Determine AM or PM suffix
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12; // Convert to 12-hour format
  hours = hours ? String(hours).padStart(2, '0') : '12'; // Leading zero or 12

  // Format date and time
  return `${day}/${month}/${year}, ${hours}:${minutes}:${seconds} ${ampm}`;
});


Handlebars.registerHelper('calcTotalAmount', function (duration, rate) {
  return ((duration / 60) * rate).toFixed(2); // Calculate total as duration * rate, rounded to 2 decimals
});

// Register a helper to get the current date
Handlebars.registerHelper('currentDate', function () {
  const now = new Date();
  const day = String(now.getDate()).padStart(2, '0'); // Pad with leading zero if needed
  const month = String(now.getMonth() + 1).padStart(2, '0'); // Months are zero-indexed
  const year = now.getFullYear();
  return `${day}/${month}/${year}`;
});

// Helper to calculate totals for the summary
function calculateSummary(data) {
  let totalVMs = data.filter(vm => vm.name).length; // Only count VMs with valid names
  let totalAmount = data.reduce((sum, vm) => {
    return vm.name ? sum + ((vm.duration / 60) * vm.rate) : sum; // Calculate total only for valid VMs
  }, 0).toFixed(2);
  return { totalVMs, totalAmount };
}

// Function to generate PDF
function generatePdfReport(data) {
  // Read the HTML template
  const templateHtml = fs.readFileSync('summary_template.html', 'utf8');
  
  // Compile the Handlebars template
  const template = Handlebars.compile(templateHtml);

  // Calculate the summary totals for the provided data
  const summary = calculateSummary(data);
  // Generate the final HTML using Handlebars
  const finalHtml = template({ ...data, ...summary });

  // Pass the generated HTML to `html-pdf-node`
  let file = { content: finalHtml };
  let options = {
    format: 'A4',
    args: ['--no-sandbox', '--disable-setuid-sandbox'], // Avoid sandboxing issues in Docker
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser'
  };
  // Generate PDF and return a promise
  return html_to_pdf.generatePdf(file, options).then(pdfBuffer => {
    // Save the PDF buffer to a file
    fs.writeFileSync(invoicePath, pdfBuffer);
    console.log('PDF generated and saved as summary.pdf');
    return pdfBuffer;
  }).catch(err => {
    console.error('Error generating PDF:', err);
  });
}

module.exports = {generatePdfReport};
