import crypto from "crypto";

export interface AwsSigV4Options {
  method: string;
  url: string;
  region: string;
  service: string;
  headers: Record<string, string>;
  body: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
}

/**
 * Standard AWS Signature Version 4 (SigV4) Request Signer.
 * Computes canonical headers, credential scope, signing key, and HMAC-SHA256 signature.
 */
export function signAwsRequest(options: AwsSigV4Options): Record<string, string> {
  const urlObj = new URL(options.url);
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.substring(0, 8);

  const headers: Record<string, string> = { ...options.headers };
  headers["host"] = urlObj.host;
  headers["x-amz-date"] = amzDate;
  if (options.sessionToken) {
    headers["x-amz-security-token"] = options.sessionToken;
  }

  const payloadHash = crypto.createHash("sha256").update(options.body).digest("hex");

  const sortedHeaderKeys = Object.keys(headers)
    .map((k) => k.toLowerCase())
    .sort();
  const canonicalHeaders = sortedHeaderKeys
    .map((k) => `${k}:${headers[k].trim()}\n`)
    .join("");
  const signedHeaders = sortedHeaderKeys.join(";");

  const canonicalRequest = [
    options.method.toUpperCase(),
    urlObj.pathname || "/",
    urlObj.searchParams.toString(),
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${options.region}/${options.service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    crypto.createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  // Derive HMAC signing key
  const kDate = crypto.createHmac("sha256", "AWS4" + options.secretAccessKey).update(dateStamp).digest();
  const kRegion = crypto.createHmac("sha256", kDate).update(options.region).digest();
  const kService = crypto.createHmac("sha256", kRegion).update(options.service).digest();
  const kSigning = crypto.createHmac("sha256", kService).update("aws4_request").digest();

  const signature = crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  headers["Authorization"] = `AWS4-HMAC-SHA256 Credential=${options.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return headers;
}
