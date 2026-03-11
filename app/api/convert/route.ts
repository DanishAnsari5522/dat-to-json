import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, unlink } from "fs/promises";
import path from "path";
import os from "os";

const execFilePromise = promisify(execFile);

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
    tempFilePath = path.join(tempDir, `upload_${Date.now()}_${file.name}`);
    await writeFile(tempFilePath, buffer);

    // Call the Python converter script
    const scriptPath = path.join(process.cwd(), "converter.py");
    
    try {
      // Execute python script
      const { stdout } = await execFilePromise("python", [scriptPath, tempFilePath]);
      const result = JSON.parse(stdout);

      if (result.error) {
        return NextResponse.json({ error: result.error }, { status: 422 });
      }

      // Return the result data (which includes format info)
      return NextResponse.json(result);
    } catch (execError: any) {
      console.error("Python Execution Error:", execError);
      return NextResponse.json({ 
        error: "Conversion engine failed. Make sure Python is installed on the server.",
        details: execError.message 
      }, { status: 500 });
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
