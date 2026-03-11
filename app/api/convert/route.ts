import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import path from "path";
import os from "os";
import zlib from "zlib";

const execFilePromise = promisify(execFile);
const gunzip = promisify(zlib.gunzip);
const inflate = promisify(zlib.inflate);

/**
 * Robust DAT to JSON converter logic (Pure JS Fallback)
 */
function isMostlyText(text: string): boolean {
  if (!text) return false;
  // Count non-printable/weird characters
  // We allow common whitespace (tab, newline, carriage return)
  // but block most other control characters and excessive non-latin characters 
  // unless they are in common ranges.
  const weirdChars = text.match(/[^\x20-\x7E\s\u00A0-\u00FF]/g);
  const ratio = (weirdChars?.length || 0) / text.length;
  return ratio < 0.15; // If more than 15% is "weird", it's probably binary
}

function tryDecodeText(data: Buffer): string | null {
  // Try UTF-8 first
  try {
    const utf8 = data.toString('utf-8');
    if (isMostlyText(utf8)) return utf8;
  } catch (e) {}

  // Try UTF-16LE (common on Windows)
  try {
    const utf16 = data.toString('utf16le');
    if (isMostlyText(utf16)) return utf16;
  } catch (e) {}

  return null;
}

function extractStrings(data: Buffer): string[] {
  // Extract ASCII strings of length 4+
  const str = data.toString('binary');
  const matches = str.match(/[\x20-\x7E]{4,}/g);
  return matches || [];
}

function parseJS(text: string) {
  // 1. Try JSON
  try {
    return { format: "json", data: JSON.parse(text) };
  } catch (e) {}

  // 2. Try CSV/TSV
  try {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length > 1) {
      const firstLine = lines[0];
      let delim = ",";
      if (firstLine.includes("\t")) delim = "\t";
      else if (firstLine.includes(";")) delim = ";";
      else if (firstLine.includes("|")) delim = "|";

      const headers = firstLine.split(delim).map(h => h.trim());
      if (headers.length > 1) {
        const rows = lines.slice(1).map(line => {
          const values = line.split(delim).map(v => v.trim());
          const obj: any = {};
          headers.forEach((h, i) => {
            let val: any = values[i] || "";
            // Auto coerce
            if (!isNaN(val as any) && val !== "") val = Number(val);
            else if (val.toLowerCase() === "true") val = true;
            else if (val.toLowerCase() === "false") val = false;
            obj[h] = val;
          });
          return obj;
        });
        return { format: "csv_js", data: rows };
      }
    }
  } catch (e) {}

  // 3. Try Key-Value
  try {
    const lines = text.trim().split(/\r?\n/);
    const result: any = {};
    let count = 0;
    lines.forEach(line => {
      const parts = line.split(/[=:]/);
      if (parts.length >= 2) {
        const key = parts[0].trim();
        let val = parts.slice(1).join("=").trim();
        if (key && !key.startsWith("#")) {
          if (!isNaN(val as any) && val !== "") val = Number(val) as any;
          result[key] = val;
          count++;
        }
      }
    });
    if (count >= 2) return { format: "kv_js", data: result };
  } catch (e) {}

  return null;
}

export async function POST(req: NextRequest) {
  let tempFilePath = "";
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    
    // --- TRY DECOMPRESSION ---
    let processedBuffer = buffer;
    let decompressionName = "";
    
    try {
      if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
        processedBuffer = await gunzip(buffer);
        decompressionName = "gzip";
      } else if (buffer[0] === 0x78) { // Likely zlib header
        processedBuffer = await inflate(buffer);
        decompressionName = "zlib";
      }
    } catch (e) {
      // Fallback to original buffer if decompression fails
      processedBuffer = buffer;
    }

    // Create a temporary file to process
    const tempDir = os.tmpdir();
    tempFilePath = path.join(tempDir, `upload_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`);
    await writeFile(tempFilePath, processedBuffer);

    // Call the Python converter script
    const scriptPath = path.join(process.cwd(), "converter.py");
    
    try {
      // Execute python script
      let stdout;
      try {
        const res = await execFilePromise("python3", [scriptPath, tempFilePath]);
        stdout = res.stdout;
      } catch (e) {
        const res = await execFilePromise("python", [scriptPath, tempFilePath]);
        stdout = res.stdout;
      }
      
      const result = JSON.parse(stdout);
      if (result.error) return NextResponse.json({ error: result.error }, { status: 422 });
      
      if (decompressionName) {
        result.format = `${decompressionName}_${result.format}`;
      }
      return NextResponse.json(result);

    } catch (execError: any) {
      console.warn("Python execution failed, falling back to JS parser:", execError.message);
      
      // FALLBACK TO JAVASCRIPT PARSER
      const text = tryDecodeText(processedBuffer);
      if (text) {
        const jsResult = parseJS(text);
        if (jsResult) {
          return NextResponse.json({
            ...jsResult,
            note: `Processed using JS fallback (${decompressionName || 'plain text'}).`
          });
        }
        
        return NextResponse.json({
            format: "text_raw",
            data: text.slice(0, 5000) + (text.length > 5000 ? "... [truncated]" : ""),
            note: "Detected as text but structured format unknown."
        });
      }

      // If text fails, try string extraction as a final readability boost
      const strings = extractStrings(processedBuffer);
      if (strings.length > 5) {
        return NextResponse.json({
          format: "extracted_strings",
          data: strings.slice(0, 100),
          note: "Binary file. Extracted readable fragments."
        });
      }

      return NextResponse.json({ 
        format: "binary_hex",
        data: processedBuffer.slice(0, 1024).toString('hex').match(/.{1,2}/g)?.join(' ') || "",
        note: "Pure binary data detected. No readable text found."
      }, { status: 200 });
    }
  } catch (error) {
    console.error("Route Error:", error);
    return NextResponse.json({ error: "Failed to process the uploaded file." }, { status: 500 });
  } finally {
    // Clean up temporary file
    if (tempFilePath) {
      try {
        await unlink(tempFilePath);
      } catch (err) {
        console.error("Failed to delete temp file:", err);
      }
    }
  }
}
