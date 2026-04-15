require('dotenv').config()
const User = require('./../models/user')
const { logger } = require('./../plugins/logger')
const Organization = require('./../models/organization')
const Templates = require('./../models/templates')
const Training = require('./../models/training')
const VM = require('./../models/vm')
const path = require('path');
const Razorpay = require('razorpay')
const { timeStamp } = require('console')
const crypto = require('crypto');
const fs = require('fs');
const { createObjectCsvWriter } = require('csv-writer');
const queues = require('./newQueues')
const PDFDocument = require('pdfkit'); // ✅ ADD PDFKIT
const https = require('https');


const razorpayId = process.env.RAZORPAY_ID;
const razorpayKey = process.env.RAZORPAY_KEY;

const razorpay = new Razorpay({
    key_id: razorpayId,
    key_secret: razorpayKey
});

// ✅ PDF Generation Function - PLACE THIS BEFORE ALL OTHER FUNCTIONS
// ✅ PDF Generation Function - FIXED for PDFKit

const generateInvoicePDF = (invoiceData, organization) => {
  return new Promise((resolve, reject) => {
    const fetchBufferFromUrl = (url) =>
      new Promise((res) => {
        https.get(url, (r) => {
          if (r.statusCode !== 200) return res(null);
          const chunks = [];
          r.on('data', (c) => chunks.push(c));
          r.on('end', () => res(Buffer.concat(chunks)));
        }).on('error', () => res(null));
      });

    (async () => {
      try {
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        const buffers = [];
        doc.on('data', buffers.push.bind(buffers));
        doc.on('end', () => resolve(Buffer.concat(buffers)));

        const setFont = (bold = false, size = 9, color = '#333333') => {
          doc.font(bold ? 'Helvetica-Bold' : 'Helvetica');
          doc.fontSize(size).fillColor(color);
        };
        const formatINR = (n) =>
          `INR ${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

        // ===== Header (plain white with only logo) =====
        const headerH = 100;
        const paintHeaderBar = () => {};
        paintHeaderBar();

        // logo
        const logoBuf = await fetchBufferFromUrl('https://synergificsoftware.com/assets/images/logo.png');
        if (logoBuf) doc.image(logoBuf, 50, 20, { height: 60 });
        else { setFont(true, 22, '#333333'); doc.text('SYNERGIFIC SOFTWARE', 50, 30); }

        // ===== Company + Invoice strip (FULL grey background) =====
        const stripY = 115;
        const stripH = 100;
        doc.save().fillColor('#f8f9fa');
        doc.rect(0, stripY, doc.page.width, stripH).fill();
        doc.restore();

        // Company text
        setFont(true, 14, '#333333'); doc.text('SYNERGIFIC SOFTWARE PRIVATE LIMITED', 50, 120);
        setFont(false, 9, '#666666');
        doc.text('46/4, Novel Tech Park, GB Palya, Kudlu Gate', 50, 140)
            .text('Bengaluru - 560029', 50, 152)
            .text('KARNATAKA, INDIA', 50, 164)
            .text('Email: muneeb@synergificsoftware.com', 50, 176)
            .text('Mobile: +91 9541551557', 50, 188)
            .text('GSTIN: 29ABDC56932Q1ZH', 50, 200);

        // Invoice details
        const invBoxX = doc.page.width - 200, invBoxW = 160;
        const invDate = new Date(invoiceData.date);
        const dueDate = new Date(invDate); dueDate.setDate(invDate.getDate() + 15);

        setFont(true, 12, '#333333'); doc.text('INVOICE', invBoxX + 10, 130);
        setFont(false, 9, '#666666');
        doc.text(`Invoice No: ${invoiceData.id}`, invBoxX + 10, 145)
           .text(`Date: ${invDate.toLocaleDateString('en-IN')}`, invBoxX + 10, 157)
           .text(`Due Date: ${dueDate.toLocaleDateString('en-IN')}`, invBoxX + 10, 169);

        // ===== Bill To (auto-adjust & gap already implemented) =====
        const customerY = 225;
        setFont(true, 11, '#333333'); doc.text('Bill To:', 50, customerY);

        const cd = invoiceData.customerDetails || {};
        const blockX = 50, blockW = 650;
        let y = customerY + 16;

        const writeLine = (txt, bold = false) => {
          if (!txt) return;
          setFont(bold, 9, '#666666');
          const opts = { width: blockW };
          doc.text(String(txt), blockX, y, opts);
          y += doc.heightOfString(String(txt), opts) + 2;
        };

        writeLine(cd.company || organization, true);
        writeLine(cd.name || '');
        writeLine(cd.address || '');
        writeLine(cd.gstin ? `GSTIN: ${cd.gstin}` : '');
        writeLine(cd.pan   ? `PAN: ${cd.pan}`     : '');
        writeLine(cd.email ? `Email: ${cd.email}` : '');

        // ===== Table header =====
        const tableLeft  = 50;
        const tableRight = doc.page.width - 50;
        const tableWidth = tableRight - tableLeft;

        let currentY = y + 15;

        const drawTableHeader = () => {
          doc.save().fillColor('#667eea');
          doc.rect(tableLeft, currentY, tableWidth, 20).fill(); doc.restore();
          setFont(true, 9, 'white');
          doc.text('Description', tableLeft + 5, currentY + 6, { width: 240 });
          doc.text('Rate (INR)',  tableLeft + 250, currentY + 6, { width: 60, align: 'right' });
          doc.text('Qty',         tableLeft + 315, currentY + 6, { width: 40, align: 'center' });
          doc.text('Total (INR)', tableLeft + 380, currentY + 6, { width: 110, align: 'right' });
        };
        drawTableHeader();
        currentY += 25;

        const addNewPage = (withTableHeader = false) => {
          doc.addPage();
          currentY = 50;
          if (withTableHeader) { drawTableHeader(); currentY += 25; }
        };
        const ensureForTable = (yNeeded) => {
          const reserve = 120;
          if (yNeeded > doc.page.height - reserve) addNewPage(true);
        };
        const ensureForBlock = (yNeeded) => {
          const reserve = 120;
          if (yNeeded > doc.page.height - reserve) addNewPage(false);
        };

        const addRow = (desc, rate, qty, total, zebra) => {
          const textHeight = doc.heightOfString(desc, { width: 240 });
          const rowH = Math.max(25, textHeight + 12);
          ensureForTable(currentY + rowH);
          if (zebra) { doc.save().fillColor('#f8f9fa'); doc.rect(tableLeft, currentY, tableWidth, rowH).fill(); doc.restore(); }
          setFont(false, 8, '#333333');
          doc.text(desc,             tableLeft + 5,   currentY + 6, { width: 240 });
          doc.text(formatINR(rate),  tableLeft + 250, currentY + 6, { width: 60,  align: 'right' });
          doc.text(String(qty),      tableLeft + 315, currentY + 6, { width: 40,  align: 'center' });
          doc.text(formatINR(total), tableLeft + 380, currentY + 6, { width: 110, align: 'right' });
          currentY += rowH + 5;
        };

        const gstPct = (() => {
        const raw = invoiceData.gstDetails?.gstPercentage;
        const n = Number(String(raw ?? '').replace('%', '').trim());
        return Number.isFinite(n) ? n : 18; // default to 18% if missing/invalid
        })();

        if (invoiceData.items && invoiceData.items.length) {
          invoiceData.items.forEach((item, i) => {
            const itemTotal = Number(item.price) * Number(item.quantity);
            const itemGst   = (itemTotal * gstPct) / 100;
            const rowTotal  = itemTotal + itemGst;

            const descText = [
              (item.name || 'Item').trim(),
              (item.description ? String(item.description).trim() : ''),
              'SAC: 998213'
            ].filter(Boolean).join('\n');

            addRow(descText, item.price, item.quantity, rowTotal, i % 2 === 1);
          });
        } else {
          const base     = Number(invoiceData.amount) || 0;
          const gst      = (base * gstPct) / 100;
          const rowTotal = invoiceData.gstDetails?.totalAmount ?? (base + gst);
          const descText = [(invoiceData.particular || 'Services'), 'SAC: 998213'].join('\n');
          addRow(descText, base, 1, rowTotal, false);
        }

        const baseAmount  = invoiceData.gstDetails?.baseAmount  ?? (invoiceData.amount || 0);
        const gstAmount   = invoiceData.gstDetails?.gstAmount   ?? (baseAmount * gstPct / 100);
        const totalAmount = invoiceData.gstDetails?.totalAmount ?? (baseAmount + gstAmount);

        let summaryY = currentY + 10;
        ensureForBlock(summaryY + 200);

        const bankBoxX = 50, bankBoxW = 340, bankBoxH = 100;
        doc.save().fillColor('#f8f9fa').rect(bankBoxX, summaryY, bankBoxW, bankBoxH).fill().restore();
        setFont(true, 10, '#333333'); doc.text('Bank Details', bankBoxX + 10, summaryY + 10);
        setFont(false, 9, '#666666');
        doc.text('Bank Name: ICICI BANK LIMITED', bankBoxX + 10, summaryY + 28)
           .text('Account Name: SYNERGIFIC SOFTWARE PRIVATE LIMITED', bankBoxX + 10, summaryY + 40)
           .text('Account Number: 029705006065', bankBoxX + 10, summaryY + 52)
           .text('IFSC Code: ICIC0000297', bankBoxX + 10, summaryY + 64);

        const sumBoxX = doc.page.width - 250, sumBoxW = 200, sumBoxH = 80;
        doc.save().fillColor('#f8f9fa').rect(sumBoxX, summaryY, sumBoxW, sumBoxH).fill().restore();
        setFont(false, 9, '#333333');
        doc.text('Taxable Amount:', sumBoxX + 10, summaryY + 10)
           .text(`GST (${gstPct}%):`, sumBoxX + 10, summaryY + 27)
           .text('Total Amount:',    sumBoxX + 10, summaryY + 46);
        const valueX = sumBoxX + 10, valueW = sumBoxW - 20;
        doc.text(formatINR(baseAmount),  valueX, summaryY + 10, { width: valueW, align: 'right' })
           .text(formatINR(gstAmount),   valueX, summaryY + 27, { width: valueW, align: 'right' });
        setFont(true, 9, '#333333');
        doc.text(formatINR(totalAmount), valueX, summaryY + 46, { width: valueW, align: 'right' });

        summaryY += Math.max(bankBoxH, sumBoxH) + 15;
        ensureForBlock(summaryY + 60);
        const words = (() => {
          const n = Math.round(totalAmount);
          const ones = ['', 'One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
          const tens = ['', '', 'Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
          const toWords = (num) => {
            if (num === 0) return 'Zero';
            if (num < 20) return ones[num];
            if (num < 100) return tens[Math.floor(num/10)] + (num%10? ' ' + ones[num%10] : '');
            if (num < 1000) return ones[Math.floor(num/100)] + ' Hundred' + (num%100? ' ' + toWords(num%100):'');
            if (num < 100000) return toWords(Math.floor(num/1000)) + ' Thousand' + (num%1000? ' ' + toWords(num%1000):'');
            if (num < 10000000) return toWords(Math.floor(num/100000)) + ' Lakh' + (num%100000? ' ' + toWords(num%100000):'');
            return toWords(Math.floor(num/10000000)) + ' Crore' + (num%10000000? ' ' + toWords(num%10000000):'');
          };
          return `INR ${toWords(n)} Only`;
        })();
        doc.save().fillColor('#e7f3ff').rect(50, summaryY, doc.page.width - 100, 40).fill().restore();
        setFont(false, 9, '#1e40af');
        doc.text(`Total in Words: ${words}`, 60, summaryY + 12, { width: doc.page.width - 120 });

        const termsY = summaryY + 50;
        ensureForBlock(termsY + 100);
        doc.save().fillColor('#fff3cd').rect(50, termsY, doc.page.width - 100, 90).fill().restore();
        setFont(true, 10, '#856404'); doc.text('Terms & Conditions', 60, termsY + 10);
        setFont(false, 8, '#856404');
        doc.text(
          'INCOME TAX DECLARATION - TDS ON SOFTWARE SALES\n' +
          'It is hereby confirmed that there is no modification on the software being supplied vide this invoice and it has been supplied as is. ' +
          'You are not required to deduct TDS on this invoice as per Notification No.-21/2021 [F.No. 142/10/2021-SO(TPL)] S.O. 1233(E), dated 13-6-2023 issued by the Ministry of Finance, Government of India.',
          60, termsY + 26, { width: doc.page.width - 120 }
        );

        let footerY = termsY + 90 + 30;
        const footerHeight = 60;
        const bottomLimit  = doc.page.height - 80;
        if (footerY > bottomLimit - footerHeight) {
          footerY = bottomLimit - footerHeight;
        }
        setFont(true, 9, '#6c757d');
        doc.text('For SYNERGIFIC SOFTWARE PRIVATE LIMITED', 0, footerY, { align: 'center' });
        setFont(false, 9, '#6c757d');
        doc.text('Authorised Signatory', 0, footerY + 12, { align: 'center' });
        setFont(false, 7, '#999999');
        doc.text('This is a computer generated invoice, hence the signature is not required.', 0, footerY + 30, { align: 'center' })
           .text('Thank you.', 0, footerY + 42, { align: 'center' });

        doc.end();
      } catch (e) { reject(e); }
    })();
  });
};


// ✅ ALL YOUR EXISTING FUNCTIONS START HERE - KEEP THEM EXACTLY AS THEY WERE
async function handleFetchOrganization(req, res) {
    const results = await Organization.find({});
    const organization = results.map(result => result.organization);
    res.status(200).json({ organization: organization });
}

async function handleDeleteOrganization(req, res) {
    const { organization } = req.body;
    console.log(organization)

    try {
        await Organization.findOneAndDelete({ organization: organization })
        return res.status(200).json({ message: `Organization : ${organization} deleted` })
    } catch (error) {
        logger.error(`Error Deleting Organization ${organization}`)
        return res.status(500).json({ message: "Internal Error" })
    }
}

async function handleCreateOrganization(req, res) {
    const { organization } = req.body;
    if (!organization)
        return res.status(400).json({ message: "Data insufficient" })
    
    // ✅ FIX: Only trim leading/trailing spaces, preserve internal spaces
    let cleanOrganization = organization.trim();
    
    try {
        await Organization.create({
            organization: cleanOrganization, // Now stores with spaces
        });
        res.status(200).json({ message: "Organization Created" })
    } catch (error) {
        logger.error(`Error in creating Organization ${organization}`)
        res.status(500).json({ message: "Internal Error" })
    }
}

async function handleFetchUsers(req, res) {
    const users = await User.find({}, 'email userType userTag organization -_id');
    res.status(200).json(users);
}

async function handleAssignTemplate(req, res) {
    const { organization, template } = req.body;
    if (!organization || !template)
        return res.status(400).json({ message: "Organization and template required to assign" })
    try {
        await Organization.findOneAndUpdate({ organization: organization }, { $push: { templates: template } })
        res.status(200).json({ message: `Template ${template} assigned to ${organization}` })
    } catch (error) {
        logger.error('Error assigning Template:', error.message);
        res.status(500).json({ message: 'Internal Server Error' });
    }
}

async function handleDeleteAssignTemplate(req, res) {
    const { organization, template } = req.body;
    if (!organization || !template)
        return res.status(400).json({ message: "Organization and template required to remove assigned" })
    try {
        await Organization.findOneAndUpdate({ organization: organization }, { $pull: { templates: template } })
        res.status(200).json({ message: `Template ${template} removed from ${organization}` })
    } catch (error) {
        logger.error('Error removing Template:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

async function handleGetAssignTemplate(req, res) {
    try {
        const organizations = await Organization.find({}, "organization templates");

        const formattedTemplates = organizations.flatMap(org =>
            org.templates.map(template => ({
                organization: org.organization,
                template: template
            }))
        );

        res.status(200).json(formattedTemplates);
    } catch (error) {
        logger.error('Error Fetching assigned Template:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

async function handleGetTemplate(req, res) {
    try {
        const templates = await Templates.find({}, "name creation.vmSize creation.os creation.licence")
        res.status(200).json(templates)
    } catch (error) {
        logger.error('Error fetching Template:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

async function handleDeleteTemplate(req, res) {
    const { template } = req.body;
    console.log(template)
    try {
        await Templates.findOneAndDelete({ name: template })
        res.status(200).json({ message: "Template Deleted" })
    } catch (error) {
        logger.error('Error fetching Template:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

async function handleCreateTemplate(req, res) {
    const { name, rate, resourceGroup, vmSize, imageId, location, os, vnet, licence, cpu, memory, storage, disk, planPublisher, product, version, isOfficial } = req.body;
    try {
        await Templates.create({
            name: name,
            rate: rate,
            creation: {
                resourceGroup: resourceGroup,
                vmSize: vmSize,
                imageId: imageId,
                location: location,
                os: os,
                vnet: vnet,
                licence: licence,
                planPublisher: planPublisher,
                product: product,
                version: version,
                official: isOfficial || false
            },
            display: {
                cpu: cpu,
                memory: memory,
                os: os,
                storage: storage,
                disk: disk
            }
        })
        res.status(200).json({ message: "Template Created" })
    } catch (error) {
        logger.error('Error fetching Template:', error.message);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

async function handleCreateUser(req, res) {
    const { email, password, organization, name, userType } = req.body;
    if (!email || !password || !organization || !userType)
        return res.status(400).json({ message: "Data insufficient" })

    try {
        const newUser = new User({
            email: email,
            password: password,
            organization: organization,
            name: name,
            userType: userType
        });
        await newUser.save();
        res.status(200).json({ message: "User Created" })

    } catch (error) {
        logger.error(`Error in creating user ${email}`)
        res.status(500).json({ message: "Internal Error" })
    }
}

async function handleDeleteUser(req, res) {
    const { email, organization } = req.body;
    if (!email || !organization)
        return res.status(400).json({ message: "Data insufficient" })

    try {
        await User.findOneAndDelete({ email: email, organization: organization })
        res.status(200).json({ message: "User Deleted" })

    } catch (error) {
        logger.error(`Error in deleting user ${email}`)
        res.status(500).json({ message: "Internal Error" })
    }
}

async function handleDeleteLogs(req, res) {
    const { trainingName } = req.body;

    if (!trainingName) {
        return res.status(400).json({ message: "Training Name is required" });
    }

    try {
        const data = await Training.findOne({ name: trainingName }, "vmUserMapping.userEmail status organization -_id").lean();

        if (!data) {
            return res.status(404).json({ error: 'Training not found' });
        }

        if (data.status !== "deleted") {
            return res.status(400).json({ message: "Please Kill the training first" });
        }

        const organization = data.organization;

        if (!organization) {
            return res.status(400).json({ message: "Organization not found for this training" });
        }

        const adminData = await User.findOne({ organization: organization, userType: "admin" }, 'email -_id').lean();

        if (!adminData || !adminData.email) {
            return res.status(404).json({ message: "Admin for this organization not found" });
        }

        const adminEmail = adminData.email;

        const vmData = await VM.find({ trainingName: trainingName }, 'name trainingName email logs duration rate -_id').lean();

        const timestamp = new Date().toISOString().replace(/:/g, '-').replace('T', '_').split('.')[0];
        const directoryPath = `/usr/src/app/shared_logs/${organization}`;

        if (!fs.existsSync(directoryPath)) {
            fs.mkdirSync(directoryPath, { recursive: true });
        }

        const csvFilePath = `${directoryPath}/${trainingName}_${timestamp}.csv`;

        const csvWriter = createObjectCsvWriter({
            path: csvFilePath,
            header: [
                { id: 'name', title: 'VM Name' },
                { id: 'trainingName', title: 'Training Name' },
                { id: 'email', title: 'User Email' },
                { id: 'action', title: 'Action' },
                { id: 'timestamp', title: 'Time' },
                { id: 'duration', title: 'Duration (mins)' },
                { id: 'rate', title: 'Rate' }
            ]
        });

        const formatTimestamp = (isoDate) => {
            if (!isoDate) return "N/A";

            try {
                const utcDate = new Date(isoDate);
                if (isNaN(utcDate.getTime())) throw new Error("Invalid Date");

                const istOffset = 5.5 * 60 * 60 * 1000;
                const istDate = new Date(utcDate.getTime() + istOffset);

                return istDate.toISOString().replace('T', ' ').slice(0, 19);
            } catch (error) {
                console.error("Invalid timestamp detected:", isoDate);
                return "Invalid Date";
            }
        };

        async function generateCSV(vmData) {
            try {
                const csvData = [];

                vmData.forEach(vm => {
                    vm.logs.forEach(log => {
                        csvData.push({
                            name: vm.name,
                            trainingName: vm.trainingName,
                            email: vm.email,
                            action: 'Start',
                            timestamp: formatTimestamp(log.start),
                        });

                        csvData.push({
                            name: vm.name,
                            trainingName: vm.trainingName,
                            email: vm.email,
                            action: 'Stop',
                            timestamp: formatTimestamp(log.stop),
                            duration: log.duration ? log.duration.toFixed(2) : "0.00",
                            rate: vm.rate ? vm.rate.toFixed(2) : "0.00"
                        });
                    });
                });

                if (csvData.length === 0) {
                    console.warn("No logs found, CSV generation skipped.");
                    return;
                }

                await csvWriter.writeRecords(csvData);
                console.log('CSV file created successfully:', csvFilePath);
            } catch (error) {
                console.error('Error writing CSV:', error);
            }
        }

        await generateCSV(vmData);

        if (fs.existsSync(csvFilePath)) {
            const emailData = {
                email: adminEmail,
                subject: "Your VM Usage Report is ready",
                body: `
                <p style="font-size: 16px; color: #333; margin: 0;">Dear ${organization},</p>
                <p style="font-size: 16px; color: #333; margin: 10px 0;">
                    We are pleased to inform you that your usage report is ready. Please find the attached document for your review.
                </p>
                <p style="font-size: 16px; color: #333; margin: 10px 0;">
                    We will be sending you a tax invoice shortly.
                </p>
                <p style="font-size: 16px; color: #333; margin: 10px 0;">
                    Thank you for choosing Synergific Software. We appreciate your trust in us and look forward to assisting you with any further requirements you may have.
                </p>
                <p style="font-size: 16px; color: #333; margin: 10px 0;">Best regards,</p>
                <p style="font-size: 16px; color: #333; margin: 10px 0;">
                    Krishan Agarwal <br/>
                    Delivery Team <br/>
                    Synergific Software Pvt. Ltd. <br/>
                    <a href="mailto:mahesh.hiremath@synergificsoftware.com" style="color: #1a73e8; text-decoration: none;">mahesh.hiremath@synergificsoftware.com</a>
                </p>
            `,
                attachment: {
                    filename: `${trainingName}_${timestamp}.csv`,
                    path: csvFilePath
                },
            };

            await queues['email-queue'].add(emailData);
        } else {
            console.error("CSV file not found, email not queued.");
        }

        const userEmails = data.vmUserMapping.map(({ userEmail }) => userEmail);

        await VM.deleteMany({ trainingName });
        await User.deleteMany({
            email: { $in: userEmails },
            userType: { $eq: 'user' }
        });
        await Training.deleteOne({ name: trainingName });

        res.status(200).json({ message: "Database Cleaned" });

    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
}

const handleGetAccounts = async (req, res) => {
    try {
        let organization;

        if (req.user.userType === 'superadmin') {
            organization = req.query.organization;
        } else {
            organization = req.user.organization;
        }

        if (!organization) {
            return res.status(400).json({ message: "Organization parameter is required" });
        }

        const accountDetails = await Organization.findOne(
            { organization: organization },
            'transactions legal'
        ).lean();

        if (!accountDetails) {
            return res.status(404).json({ message: "Organization not found" });
        }

        return res.status(200).json(accountDetails);
    } catch (error) {
        logger.error("Error fetching account details:", error);
        return res.status(500).json({
            message: "Error retrieving account details",
            error: error.message || "Unknown error"
        });
    }
};

const handleGetLedger = async (req, res) => {
    try {
        const organizations = await Organization.find({}, 'organization legal').lean();

        if (!organizations || organizations.length === 0) {
            return res.status(404).json({ message: "No organizations found" });
        }

        let totalInvoice = 0;
        let totalPayment = 0;
        let totalBalance = 0;

        const ledgerArray = organizations.map(org => {
            const { invoice = 0, payment = 0, balance = 0, name } = org.legal || {};

            totalInvoice += invoice;
            totalPayment += payment;
            totalBalance += balance;

            return {
                name: name,
                organization: org.organization,
                invoice,
                payment,
                balance
            };
        });

        return res.status(200).json({
            totalInvoice,
            totalPayment,
            totalBalance,
            ledger: ledgerArray
        });

    } catch (error) {
        logger.error("Error fetching ledger data:", error);
        return res.status(500).json({
            message: "Error retrieving ledger data",
            error: error.message || "Unknown error"
        });
    }
};

const handleAddTransaction = async (req, res) => {
    try {
        let { organization, id, date, type, amount, particular, items, customerDetails, gstDetails } = req.body;

        amount = Number(amount) || 0;

        // Validate required fields
        if (!organization || !id || !amount || !date || !type) {
            return res.status(400).json({ message: "Missing required fields" });
        }

        if (amount <= 0) {
            return res.status(400).json({ message: "Amount must be greater than zero" });
        }

        type = type.toLowerCase();

        if (type !== "invoice" && type !== "payment") {
            return res.status(400).json({ message: "Invalid transaction type. Must be 'invoice' or 'payment'." });
        }

        // Create a new transaction object
        const newTransaction = {
            date: new Date(date),
            particular: particular || (type === "invoice" ? "Invoice Issued" : "Payment Received"),
            id,
            [type]: amount,
            // ✅ CORRECTED: Store complete invoice data for downloads
            ...(type === "invoice" ? {
                items: items || [],
                customerDetails: customerDetails || {},
                gstDetails: gstDetails || {}
            } : {})
        };

        // Construct $inc object for updating legal summary
        let updateFields = { [`legal.${type}`]: amount };

        if (type === "invoice") {
            updateFields["legal.balance"] = amount;
        } else {
            updateFields["legal.balance"] = -amount;
        }

        // Perform MongoDB update
        const updatedOrg = await Organization.findOneAndUpdate(
            { organization: organization },
            {
                $push: { transactions: newTransaction },
                $inc: updateFields,
            },
            { new: true, runValidators: true }
        );

        if (!updatedOrg) {
            return res.status(404).json({ message: "Organization not found" });
        }

        // ✅ ENHANCED: Send complete invoice details in email WITH PDF ATTACHMENT
        if (type === "invoice") {
        try {
            const adminUser = await User.findOne(
            { organization: organization, userType: "admin" },
            "email name -_id"
            ).lean();

            if (adminUser && adminUser.email) {
            const invoiceData = {
                id,
                date,
                particular,
                amount,
                items,
                customerDetails,
                gstDetails,
            };

            const pdfBuffer = await generateInvoicePDF(invoiceData, organization);

            const convertToWords = (num) => {
                const ones = [
                "",
                "One",
                "Two",
                "Three",
                "Four",
                "Five",
                "Six",
                "Seven",
                "Eight",
                "Nine",
                "Ten",
                "Eleven",
                "Twelve",
                "Thirteen",
                "Fourteen",
                "Fifteen",
                "Sixteen",
                "Seventeen",
                "Eighteen",
                "Nineteen",
                ];
                const tens = [
                "",
                "",
                "Twenty",
                "Thirty",
                "Forty",
                "Fifty",
                "Sixty",
                "Seventy",
                "Eighty",
                "Ninety",
                ];

                if (num === 0) return "Zero";
                if (num < 20) return ones[num];
                if (num < 100)
                return (
                    tens[Math.floor(num / 10)] +
                    (num % 10 !== 0 ? " " + ones[num % 10] : "")
                );
                if (num < 1000)
                return (
                    ones[Math.floor(num / 100)] +
                    " Hundred" +
                    (num % 100 !== 0 ? " " + convertToWords(num % 100) : "")
                );
                if (num < 100000)
                return (
                    convertToWords(Math.floor(num / 1000)) +
                    " Thousand" +
                    (num % 1000 !== 0 ? " " + convertToWords(num % 1000) : "")
                );
                if (num < 10000000)
                return (
                    convertToWords(Math.floor(num / 100000)) +
                    " Lakh" +
                    (num % 100000 !== 0 ? " " + convertToWords(num % 100000) : "")
                );
                return (
                convertToWords(Math.floor(num / 10000000)) +
                " Crore" +
                (num % 10000000 !== 0
                    ? " " + convertToWords(num % 10000000)
                    : "")
                );
            };

            const amountInWords =
                convertToWords(
                Math.round((gstDetails && gstDetails.totalAmount) || amount)
                ) + " Only";

            const gstPercent = (() => {
                const raw = gstDetails?.gstPercentage;
                const n = Number(String(raw ?? "").replace("%", "").trim());
                return Number.isFinite(n) ? n : 18;
            })();

            const emailBase = Number(gstDetails?.baseAmount ?? amount);
            const emailGst = Number(
                gstDetails?.gstAmount ?? (emailBase * gstPercent) / 100
            );
            const emailTotal = Number(
                gstDetails?.totalAmount ?? emailBase + emailGst
            );

            const emailData = {
                email: adminUser.email,
                subject: `Invoice ${id} - ${organization}`,
                body: `
                <div style="font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; background: #ffffff;">
                    <!-- Header with Logo -->
                    <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; color: white; display: flex; align-items: center; justify-content: space-between;">
                    <div style="display: flex; align-items: center;">
                        <div style="background: white; padding: 10px; border-radius: 8px; margin-right: 20px; display: flex; align-items: center; justify-content: center;">
                        <div style="width: 80px; height: 80px; display: flex; align-items: center; justify-content: center;">
                            <img src="https://synergificsoftware.com/assets/images/logo.png"
                                style="width: 100%; height: 100%; object-fit: contain;"
                                onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                        </div>
                        </div>
                    </div>
                    <div style="background: rgba(255,255,255,0.2); padding: 10px 20px; border-radius: 20px; text-align: center;">
                        <h3 style="margin: 0; font-size: 18px;">TAX INVOICE</h3>
                    </div>
                    </div>

                    <!-- Company Details -->
                    <div style="padding: 25px; background: #f8f9fa; border-bottom: 2px solid #e9ecef;">
                    <div style="display: flex; justify-content: space-between; flex-wrap: wrap;">
                        <div style="flex: 1; min-width: 300px;">
                        <h3 style="color: #333; margin-bottom: 10px;">SYNERGIFIC SOFTWARE PRIVATE LIMITED</h3>
                        <p style="margin: 5px 0; color: #666;">
                            46/4, Novel Tech Park, GB Palya, Kudlu Gate<br>
                            Bengaluru - 560029<br>
                            KARNATAKA, INDIA<br>
                            Email: muneeb@synergificsoftware.com<br>
                            Mobile: +91 9541551557<br>
                            GSTIN: 29ABDC56932Q1ZH
                        </p>
                        </div>
                        <div style="flex: 1; min-width: 300px; text-align: right;">
                        <div style="background: white; padding: 15px; border-radius: 8px; display: inline-block;">
                            <h3 style="color: #333; margin: 0; font-size: 18px;">INVOICE</h3>
                            <p style="margin: 5px 0; color: #666; font-size: 14px;">
                            <strong>Invoice No:</strong> ${id}<br>
                            <strong>Date:</strong> ${new Date(date).toLocaleDateString("en-IN")}<br>
                            <strong>Due Date:</strong> ${new Date(
                                new Date(date).setDate(new Date(date).getDate() + 15)
                            ).toLocaleDateString("en-IN")}
                            </p>
                        </div>
                        </div>
                    </div>
                    </div>

                    <!-- Customer Details -->
                    <div style="padding: 25px; display: flex; justify-content: space-between; flex-wrap: wrap; border-bottom: 2px solid #e9ecef;">
                    <div style="flex: 1; min-width: 300px;">
                        <h4 style="color: #333; margin-bottom: 15px;">Bill To:</h4>
                        <p style="margin: 5px 0; color: #666;">
                        <strong>${customerDetails?.company || organization}</strong><br>
                        ${customerDetails?.name ? customerDetails.name + "<br>" : ""}
                        ${
                            customerDetails?.address
                            ? customerDetails.address.replace(/\n/g, "<br>")
                            : ""
                        }<br>
                        ${customerDetails?.gstin ? "GSTIN: " + customerDetails.gstin + "<br>" : ""}
                        ${customerDetails?.pan ? "PAN: " + customerDetails.pan + "<br>" : ""}
                        ${customerDetails?.email ? "Email: " + customerDetails.email : ""}
                        </p>
                    </div>
                    <div style="flex: 1; min-width: 300px;">
                        <h4 style="color: #333; margin-bottom: 15px;">Ship To:</h4>
                        <p style="margin: 5px 0; color: #666;">
                        ${
                            customerDetails?.shippingAddress
                            ? customerDetails.shippingAddress.replace(/\n/g, "<br>")
                            : customerDetails?.address
                            ? customerDetails.address.replace(/\n/g, "<br>")
                            : "Same as billing address"
                        }
                        </p>
                    </div>
                    </div>

                    <!-- Items Table -->
                    <div style="padding: 25px;">
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                        <thead>
                        <tr style="background: #667eea; color: white;">
                            <th style="padding: 12px; text-align: left; border: 1px solid #ddd;">S.No.</th>
                            <th style="padding: 12px; text-align: left; border: 1px solid #ddd;">Description</th>
                            <th style="padding: 12px; text-align: right; border: 1px solid #ddd;">Rate (₹)</th>
                            <th style="padding: 12px; text-align: center; border: 1px solid #ddd;">Qty</th>
                            <th style="padding: 12px; text-align: right; border: 1px solid #ddd;">GST (₹)</th>
                            <th style="padding: 12px; text-align: right; border: 1px solid #ddd;">Total (₹)</th>
                        </tr>
                        </thead>
                        <tbody>
                        ${
                            items && items.length > 0
                            ? items
                                .map((item, index) => {
                                    const itemTotal =
                                    Number(item.price) * Number(item.quantity);
                                    const itemGst = (itemTotal * gstPercent) / 100;
                                    return `
                                    <tr>
                                        <td style="padding: 12px; border: 1px solid #ddd;">${
                                        index + 1
                                        }</td>
                                        <td style="padding: 12px; border: 1px solid #ddd;">
                                        <strong>${item.name}</strong><br>
                                        <small style="color: #666;">${
                                            item.description || ""
                                        }</small><br>
                                        <small style="color: #888;">GST: ${gstPercent}% | SAC: 998213</small>
                                        </td>
                                        <td style="padding: 12px; text-align: right; border: 1px solid #ddd;">${Number(
                                        item.price
                                        ).toLocaleString("en-IN")}</td>
                                        <td style="padding: 12px; text-align: center; border: 1px solid #ddd;">${
                                        item.quantity
                                        }</td>
                                        <td style="padding: 12px; text-align: right; border: 1px solid #ddd;">${itemGst.toFixed(
                                        2
                                        )}</td>
                                        <td style="padding: 12px; text-align: right; border: 1px solid #ddd;">${(
                                        itemTotal + itemGst
                                        ).toLocaleString("en-IN")}</td>
                                    </tr>
                                    `;
                                })
                                .join("")
                            : `
                                <tr>
                                <td style="padding: 12px; border: 1px solid #ddd;">1</td>
                                <td style="padding: 12px; border: 1px solid #ddd;">
                                    <strong>${particular || "Services"}</strong>
                                </td>
                                <td style="padding: 12px; text-align: right; border: 1px solid #ddd;">${Number(
                                    amount
                                ).toLocaleString("en-IN")}</td>
                                <td style="padding: 12px; text-align: center; border: 1px solid #ddd;">1</td>
                                <td style="padding: 12px; text-align: right; border: 1px solid #ddd;">${(
                                    (Number(amount) * gstPercent) /
                                    100
                                ).toFixed(2)}</td>
                                <td style="padding: 12px; text-align: right; border: 1px solid #ddd;">${Number(
                                    emailTotal
                                ).toLocaleString("en-IN")}</td>
                                </tr>
                            `
                        }
                        </tbody>
                    </table>

                    <!-- Summary -->
                    <div style="display: flex; justify-content: space-between; flex-wrap: wrap;">
                        <div style="flex: 1; min-width: 300px;">
                        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px;">
                            <h4 style="color: #333; margin-bottom: 10px;">Bank Details</h4>
                            <p style="margin: 5px 0; color: #666; font-size: 14px;">
                            <strong>Bank Name:</strong> ICICI BANK LIMITED<br>
                            <strong>Account Name:</strong> SYNERGIFIC SOFTWARE PRIVATE LIMITED<br>
                            <strong>Account Number:</strong> 029705006065<br>
                            <strong>IFSC Code:</strong> ICIC0000297
                            </p>
                        </div>
                        </div>
                        <div style="flex: 1; min-width: 300px;">
                        <div style="background: #f8f9fa; padding: 15px; border-radius: 8px; margin-left: 20px;">
                            <table style="width: 100%;">
                            <tr>
                                <td style="padding: 5px 0;"><strong>Taxable Amount:</strong></td>
                                <td style="padding: 5px 0; text-align: right;">₹${emailBase.toLocaleString(
                                "en-IN"
                                )}</td>
                            </tr>
                            <tr>
                                <td style="padding: 5px 0;"><strong>GST (${gstPercent}%):</strong></td>
                                <td style="padding: 5px 0; text-align: right;">₹${emailGst.toLocaleString(
                                "en-IN"
                                )}</td>
                            </tr>
                            <tr style="border-top: 2px solid #ddd;">
                                <td style="padding: 10px 0;"><strong>Total Amount:</strong></td>
                                <td style="padding: 10px 0; text-align: right; font-size: 18px; font-weight: bold; color: #28a745;">
                                ₹${emailTotal.toLocaleString("en-IN")}
                                </td>
                            </tr>
                            </table>
                        </div>
                        </div>
                    </div>

                    <!-- Amount in Words -->
                    <div style="margin-top: 20px; padding: 15px; background: #e7f3ff; border-radius: 8px;">
                        <p style="margin: 0; color: #1e40af; font-style: italic;">
                        <strong>Total in Words:</strong> Indian Rupees ${amountInWords}
                        </p>
                    </div>

                    <!-- Terms & Conditions -->
                    <div style="margin-top: 25px; padding: 15px; background: #fff3cd; border-radius: 8px; border-left: 4px solid #ffc107;">
                        <h4 style="color: #856404; margin-bottom: 10px;">Terms & Conditions</h4>
                        <p style="margin: 0; color: #856404; font-size: 12px;">
                        <strong>INCOME TAX DECLARATION - TDS ON SOFTWARE SALES</strong><br>
                        It is hereby confirmed that there is no modification on the software being supplied vide this invoice and it has been supplied as is. 
                        You are not required to deduct TDS on this invoice as per Notification No.-21/2021 [F.No. 142/10/2021-SO(TPL)] S.O. 1233(E), 
                        dated 13-6-2023 issued by the Ministry of Finance, Government of India.
                        </p>
                    </div>

                    <!-- Footer -->
                    <div style="margin-top: 30px; padding-top: 20px; border-top: 2px solid #e9ecef; text-align: center;">
                        <p style="margin: 0; color: #6c757d;">
                        <strong>For SYNERGIFIC SOFTWARE PRIVATE LIMITED</strong><br>
                        Authorised Signatory
                        </p>
                        <p style="margin: 10px 0 0 0; color: #999; font-size: 12px;">
                        This is a computer generated invoice, hence the signature is not required. Thank you.
                        </p>
                    </div>
                    </div>
                </div>
                `,
                attachment: {
                filename: `Invoice_${id}.pdf`,
                content: pdfBuffer.toString("base64"),
                encoding: "base64",
                contentType: "application/pdf",
                },
            };

            await queues["email-queue"].add(emailData);

            logger.info(
                `📧 Invoice email with PDF attachment queued for ${adminUser.email} (Organization: ${organization})`
            );
            } else {
            logger.warn(
                `⚠️ No admin user found for organization: ${organization}. Invoice created but no email sent.`
            );
            }
        } catch (emailError) {
            logger.error(`❌ Failed to queue invoice email for ${organization}:`, emailError);
        }
        }


        logger.info(`Transaction added successfully for ${organization}. Updated Invoice: ${updatedOrg.legal.invoice}, Payment: ${updatedOrg.legal.payment}, Balance: ${updatedOrg.legal.balance}`);

        return res.status(200).json({
            message: "Transaction added successfully",
            updatedBalance: updatedOrg.legal.balance,
            updatedInvoice: updatedOrg.legal.invoice,
            updatedPayment: updatedOrg.legal.payment,
        });

    } catch (error) {
        logger.error("Error adding transaction:", error);
        return res.status(500).json({
            message: "Error adding transaction",
            error: error.message || "Unknown error",
        });
    }
};

// ADD THESE FUNCTIONS TO YOUR EXISTING controllers/admin.js

const handleDeleteTransaction = async (req, res) => {
    try {
        if (req.user.userType !== 'superadmin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Only superadmins can delete transactions.'
            });
        }

        const { transactionId } = req.params;
        const { organization } = req.body;

        if (!transactionId || !organization) {
            return res.status(400).json({
                success: false,
                message: 'Transaction ID and organization are required.'
            });
        }

        const org = await Organization.findOne({ organization: organization });
        if (!org) {
            return res.status(404).json({
                success: false,
                message: 'Organization not found.'
            });
        }

        const transactionToDelete = org.transactions.find(txn => txn.id === transactionId);
        if (!transactionToDelete) {
            return res.status(404).json({
                success: false,
                message: 'Transaction not found.'
            });
        }

        const invoiceAmount = transactionToDelete.invoice || 0;
        const paymentAmount = transactionToDelete.payment || 0;

        const updatedOrg = await Organization.findOneAndUpdate(
            { organization: organization },
            { 
                $pull: { transactions: { id: transactionId } },
                $inc: {
                    "legal.invoice": -invoiceAmount,
                    "legal.payment": -paymentAmount,
                    "legal.balance": -(invoiceAmount - paymentAmount)
                }
            },
            { new: true }
        );

        if (!updatedOrg) {
            return res.status(500).json({
                success: false,
                message: 'Failed to delete transaction.'
            });
        }

        logger.info(`🗑️ Transaction deleted for ${organization}: ${transactionId}`);

        res.json({
            success: true,
            message: 'Transaction deleted successfully.',
            deletedTransaction: transactionToDelete,
            updatedBalance: updatedOrg.legal.balance
        });

    } catch (error) {
        logger.error('Delete transaction error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while deleting transaction.'
        });
    }
};

const handleUpdateTransaction = async (req, res) => {
    try {
        if (req.user.userType !== 'superadmin') {
            return res.status(403).json({
                success: false,
                message: 'Access denied. Only superadmins can update transactions.'
            });
        }

        const { transactionId } = req.params;
        const { particular, invoice, payment, date, organization } = req.body;

        if (!transactionId || !organization) {
            return res.status(400).json({
                success: false,
                message: 'Transaction ID and organization are required.'
            });
        }

        const newInvoice = parseFloat(invoice) || 0;
        const newPayment = parseFloat(payment) || 0;

        const org = await Organization.findOne({ organization: organization });
        if (!org) {
            return res.status(404).json({
                success: false,
                message: 'Organization not found.'
            });
        }

        const transactionIndex = org.transactions.findIndex(txn => txn.id === transactionId);
        if (transactionIndex === -1) {
            return res.status(404).json({
                success: false,
                message: 'Transaction not found.'
            });
        }

        const oldTransaction = org.transactions[transactionIndex];
        const oldInvoice = oldTransaction.invoice || 0;
        const oldPayment = oldTransaction.payment || 0;

        const invoiceDiff = newInvoice - oldInvoice;
        const paymentDiff = newPayment - oldPayment;
        const balanceDiff = invoiceDiff - paymentDiff;

        const updateQuery = {
            $set: {
                [`transactions.${transactionIndex}.particular`]: particular,
                [`transactions.${transactionIndex}.invoice`]: newInvoice,
                [`transactions.${transactionIndex}.payment`]: newPayment,
                [`transactions.${transactionIndex}.date`]: new Date(date)
            },
            $inc: {
                "legal.invoice": invoiceDiff,
                "legal.payment": paymentDiff,
                "legal.balance": balanceDiff
            }
        };

        const updatedOrg = await Organization.findOneAndUpdate(
            { organization: organization },
            updateQuery,
            { new: true }
        );

        if (!updatedOrg) {
            return res.status(500).json({
                success: false,
                message: 'Failed to update transaction.'
            });
        }

        logger.info(`✏️ Transaction updated for ${organization}: ${transactionId}`);

        res.json({
            success: true,
            message: 'Transaction updated successfully.',
            updatedTransaction: updatedOrg.transactions[transactionIndex],
            updatedBalance: updatedOrg.legal.balance
        });

    } catch (error) {
        logger.error('Update transaction error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while updating transaction.'
        });
    }
};

// 🔽🔽🔽 ✅ NEW: Download Invoice PDF Handler
// 🔽🔽🔽 ✅ FIXED: Download Invoice PDF Handler - Uses exact same data as email
// ✅ Download Invoice PDF Handler (matches email PDF exactly)
// ✅ Download Invoice PDF Handler (case-insensitive org match + identical to email PDF)
// ✅ Download Invoice PDF Handler (case-insensitive org match + identical to email PDF)
const handleGetInvoicePdf = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ message: 'Invoice id is required' });

    // Use org as provided (no lowercasing); for superadmin it can come from query/body
    let organization =
      req.user?.userType === 'superadmin'
        ? (req.query.organization || req.body.organization || '').trim()
        : (req.user?.organization || '').trim();

    // Helper to escape regex meta
    const escapeRegex = (s = '') => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

    // Build a case-insensitive exact-match query for organization
    const orgQuery = organization
      ? { organization: { $regex: `^${escapeRegex(organization)}$`, $options: 'i' } }
      : null;

    let orgDoc;
    let txn;

    if (orgQuery) {
      orgDoc = await Organization.findOne(orgQuery, 'organization legal transactions').lean();
      if (!orgDoc) return res.status(404).json({ message: 'Organization not found' });

      txn = (orgDoc.transactions || []).find(t => t.id === id && (t.invoice || 0) > 0);
    } else {
      // Superadmin convenience: locate by transaction id across orgs
      orgDoc = await Organization.findOne(
        { 'transactions.id': id },
        'organization legal transactions'
      ).lean();
      if (!orgDoc) return res.status(404).json({ message: 'Invoice transaction not found' });

      organization = orgDoc.organization; // whatever casing is in DB
      txn = (orgDoc.transactions || []).find(t => t.id === id && (t.invoice || 0) > 0);
    }

    if (!txn || !(txn.invoice > 0)) {
      return res.status(404).json({ message: 'Invoice transaction not found' });
    }

    // Only pass GST details if actually stored; let generator default to 18% otherwise
    const hasGstDetails = txn.gstDetails && Object.keys(txn.gstDetails).length > 0;

    const invoiceData = {
      id: txn.id,
      date: txn.date || new Date(),
      particular: txn.particular || 'Services',
      amount: Number(txn.invoice) || 0,
      items: txn.items || [],
      customerDetails: txn.customerDetails || {
        company: orgDoc?.legal?.name || organization,
        gstin: orgDoc?.legal?.gst || '',
        address: orgDoc?.legal?.address || '',
        email: orgDoc?.legal?.email || '',
        pan: orgDoc?.legal?.pan || ''
      },
      gstDetails: hasGstDetails ? txn.gstDetails : undefined
    };

    // Same generator as email → identical PDF
    const pdfBuffer = await generateInvoicePDF(invoiceData, organization);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Invoice_${id}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length);
    return res.status(200).send(pdfBuffer);
  } catch (err) {
    logger.error('❌ handleGetInvoicePdf error:', err);
    return res.status(500).json({ message: 'Failed to generate invoice PDF' });
  }
};

// Helper function to recalculate account balance (optional - you can use this for more accurate balance calculation)
const recalculateAccountBalance = async (organization) => {
    try {
        const org = await Organization.findOne({ organization: organization });
        if (!org) {
            throw new Error('Organization not found');
        }

        const totalInvoice = org.transactions.reduce((sum, txn) => sum + (txn.invoice || 0), 0);
        const totalPayment = org.transactions.reduce((sum, txn) => sum + (txn.payment || 0), 0);
        const calculatedBalance = totalInvoice - totalPayment;

        await Organization.findOneAndUpdate(
            { organization: organization },
            { 
                $set: {
                    "legal.invoice": totalInvoice,
                    "legal.payment": totalPayment,
                    "legal.balance": calculatedBalance
                }
            }
        );

        logger.info(`🔢 Balance recalculated for ${organization}: ₹${calculatedBalance.toFixed(2)}`);
        return calculatedBalance;
    } catch (error) {
        logger.error('Recalculate balance error:', error);
        throw error;
    }
};

const handleCreateOrder = async (req, res) => {
    const { amount } = req.body;
    try {
        const options = {
            amount: amount * 100,
            currency: "INR",
            receipt: `reciept#${Date.now()}`,
        }
        const order = await razorpay.orders.create(options);
        logger.info(`Order Created for ${req.user.organization}`)
        res.json({ success: true, amount: amount, order_id: order.id });

    } catch (error) {
        logger.error('Error creating Razorpay order:', error);
        res.status(500).json({ success: false, message: 'Error creating order' });
    }
}

const handlePaymentVerify = async (req, res) => {
    const { payment_id, order_id, signature, amount, invoice_ids, invoice_details } = req.body;
    const { organization: orgFromUser } = req.user || {};
    const organization = (req.body.organization || orgFromUser || "").toLowerCase().trim();

    try {
        if (!organization) {
            logger.error("❌ Payment verification failed: Missing organization");
            return res.status(400).json({ success: false, message: "Organization not provided" });
        }

        if (!payment_id || !order_id || !signature) {
            logger.error("❌ Missing payment details in verification request");
            return res.status(400).json({ success: false, message: "Incomplete payment details" });
        }

        const generated_signature = crypto
            .createHmac("sha256", razorpayKey)
            .update(order_id + '|' + payment_id)
            .digest("hex");

        if (generated_signature !== signature) {
            logger.error("❌ Invalid payment signature for:", { organization });
            return res.status(400).json({ success: false, message: "Payment verification failed" });
        }

        logger.info(`✅ Payment Verified for ${organization}`, { 
            payment_id, 
            order_id, 
            amount,
            invoice_ids: invoice_ids || [],
            timeStamp: new Date() 
        });

        const paymentAmount = Number(amount);
        if (isNaN(paymentAmount) || paymentAmount <= 0) {
            logger.error(`❌ Invalid payment amount received: ${amount}`);
            return res.status(400).json({ success: false, message: "Invalid payment amount" });
        }

        const existingOrg = await Organization.findOne({ organization });
        if (!existingOrg) {
            logger.error(`❌ Organization not found for payment: ${organization}`);
            return res.status(404).json({ success: false, message: "Organization not found" });
        }

        if (!existingOrg.legal) {
            existingOrg.legal = {
                name: organization,
                gst: "",
                limit: 0,
                balance: 0,
                invoice: 0,
                payment: 0
            };
            await existingOrg.save();
            logger.info(`ℹ️ Initialized legal structure for ${organization}`);
        }

        const paidInvoiceDetails = invoice_details || [];
        const paidInvoiceIds = invoice_ids || [];
        
        const particular = paidInvoiceIds.length > 0 
            ? `Payment for invoices: ${paidInvoiceIds.join(', ')}`
            : `Payment Received (${payment_id})`;

        const newTransaction = {
            date: new Date(),
            particular: particular,
            id: payment_id,
            payment: paymentAmount,
            paidInvoices: paidInvoiceDetails.map(inv => ({
                invoiceId: inv.id,
                amount: inv.amount,
                particular: inv.particular
            }))
        };

        const updatedOrg = await Organization.findOneAndUpdate(
            { organization },
            {
                $push: { transactions: newTransaction },
                $inc: {
                    "legal.balance": -paymentAmount,
                    "legal.payment": paymentAmount
                }
            },
            { new: true }
        );

        if (!updatedOrg) {
            logger.error(`❌ Failed to update ledger for organization: ${organization}`);
            return res.status(500).json({ success: false, message: "Failed to update ledger" });
        }

        logger.info(`💰 Ledger updated for ${organization} | Payment: ₹${paymentAmount} | Invoices: ${paidInvoiceIds.join(', ')}`);

        return res.status(200).json({
            success: true,
            message: "Payment verified and ledger updated successfully",
            updatedOrg: {
                organization: updatedOrg.organization,
                balance: updatedOrg.legal.balance,
                payment: updatedOrg.legal.payment,
                lastTransaction: newTransaction
            }
        });

    } catch (error) {
        logger.error(`❌ Error in handlePaymentVerify for ${req.body.organization}: ${error.message}`);
        return res.status(500).json({ success: false, message: "Internal Server Error", error: error.message });
    }
};

const handleCaptureVm = async (req, res) => {
    try {
        const { vm } = req.body;
        const vmData = {
            vm: vm
        }

        if (!vm) {
            return res.status(400).json({ message: "VM name is required to capture" });
        }

        await queues["azure-vm-capture"].add(vmData);
        logger.info(`VM Capture started for: ${vm}`);

        return res.status(200).json({ message: "Capture process initiated" });
    } catch (error) {
        logger.error(`Error Capturing VM: ${error.message || error}`);
        return res.status(500).json({ message: "Internal Error in capturing VM" });
    }
};

module.exports = {
    handleFetchOrganization,
    handleDeleteOrganization,
    handleCreateOrganization,
    handleFetchUsers,
    handleAssignTemplate,
    handleGetTemplate,
    handleGetAssignTemplate,
    handleCreateUser,
    handleDeleteLogs,
    handleCreateTemplate,
    handleDeleteUser,
    handleDeleteTemplate,
    handleDeleteAssignTemplate,
    handleGetAccounts,
    handleCreateOrder,
    handlePaymentVerify,
    handleGetLedger,
    handleAddTransaction,
    handleCaptureVm,
    handleDeleteTransaction,
    handleUpdateTransaction,
    // ✅ Export the new PDF download handler
    handleGetInvoicePdf
};
