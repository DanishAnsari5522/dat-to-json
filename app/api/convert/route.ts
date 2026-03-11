import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import path from "path";
import os from "os";

const execFilePromise = promisify(execFile);

/**
 * Robust DAT to JSON converter logic (Pure JS Fallback)
 */
function tryDecodeText(data: Buffer): string | null {
  const encodings = ['utf-8', 'latin1', 'utf16le'];
  for (const enc of encodings) {
    try {
      const text = data.toString(enc as BufferEncoding);
      // Basic check if it looks like healthy text (not mostly control chars)
      const controlChars = text.match(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g);
      if (!controlChars || controlChars.length / text.length < 0.1) {
        return text;
      }
    } catch (e) { continue; }
  }
  return null;
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
    
    // Create a temporary file to process
    const tempDir = os.tmpdir();
    tempFilePath = path.join(tempDir, `upload_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9.]/g, '_')}`);
    await writeFile(tempFilePath, buffer);

    // Call the Python converter script
    const scriptPath = path.join(process.cwd(), "converter.py");
    
    try {
      // Execute python script
      // We try 'python3' then 'python'
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
      return NextResponse.json(result);

    } catch (execError: any) {
      console.warn("Python execution failed, falling back to JS parser:", execError.message);
      
      // FALLBACK TO JAVASCRIPT PARSER
      const text = tryDecodeText(buffer);
      if (text) {
        const jsResult = parseJS(text);
        if (jsResult) {
          return NextResponse.json({
            ...jsResult,
            note: "Processed using JS fallback (Python not available on server)."
          });
        }
        
        return NextResponse.json({
            format: "text_raw",
            data: text.slice(0, 5000) + (text.length > 5000 ? "... [truncated]" : ""),
            note: "Could not detect structured format. Showing raw text."
        });
      }

      return NextResponse.json({ 
        format: "binary_hex",
        data: buffer.slice(0, 1024).toString('hex').match(/.{1,2}/g)?.join(' ') || "",
        note: "Binary file detected and Python is missing. Showing Hex dump."
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
