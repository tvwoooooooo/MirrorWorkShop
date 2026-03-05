// aws4fetch.js
const encoder = new TextEncoder();

const HOST_SERVICES = {
  appstream2: "appstream",
  cloudhsmv2: "cloudhsm",
  email: "ses",
  marketplace: "aws-marketplace",
  mobile: "AWSMobileHubService",
  pinpoint: "mobiletargeting",
  queue: "sqs",
  "git-codecommit": "codecommit",
  "mturk-requester-sandbox": "mturk-requester",
  "personalize-runtime": "personalize"
};

const UNSIGNABLE_HEADERS = new Set([
  "authorization", "content-type", "content-length", "user-agent",
  "presigned-expires", "expect", "x-amzn-trace-id", "range", "connection"
]);

export class AwsClient {
  constructor({ accesskeyID, secretAccessKey, sessionToken, service, region, cache, retries, initRetryMs }) {
    this.accesskeyID = accesskeyID;
    this.secretAccessKey = secretAccessKey;
    this.sessionToken = sessionToken;
    this.service = service;
    this.region = region;
    this.cache = cache || new Map();
    this.retries = retries != null ? retries : 10;
    this.initRetryMs = initRetryMs || 50;
  }

  async sign(input, init) {
    if (input instanceof Request) {
      const { method, url, headers, body } = input;
      init = Object.assign({ method, url, headers }, init);
      if (!init.body && headers.has('Content-Type')) {
        init.body = body && headers.has('X-Amz-Content-Sha256') ? body : await input.clone().arrayBuffer();
      }
      input = url;
    }
    const signer = new AwsV4Signer(Object.assign({ url: input }, init, this, init?.aws));
    const signed = Object.assign({}, init, await signer.sign());
    delete signed.aws;
    try {
      return new Request(signed.url.toString(), signed);
    } catch (e) {
      if (e instanceof TypeError) return new Request(signed.url.toString(), Object.assign({ duplex: "half" }, signed));
      throw e;
    }
  }

  async fetch(input, init) {
    for (let i = 0; i <= this.retries; i++) {
      const fetched = fetch(await this.sign(input, init));
      if (i === this.retries) return fetched;
      const res = await fetched;
      if (res.status < 500 && res.status !== 429) return res;
      await new Promise(resolve => setTimeout(resolve, Math.random() * this.initRetryMs * Math.pow(2, i)));
    }
  }
}

class AwsV4Signer {
  constructor({ method, url, headers, body, accesskeyID, secretAccessKey, sessionToken, service, region, cache, datetime, signQuery, appendSessionToken, allHeaders, singleEncode }) {
    this.method = method || (body ? "POST" : "GET");
    this.url = new URL(url);
    this.headers = new Headers(headers || {});
    this.body = body;
    this.accesskeyID = accesskeyID;
    this.secretAccessKey = secretAccessKey;
    this.sessionToken = sessionToken;
    let guessedService, guessedRegion;
    if (!service || !region) [guessedService, guessedRegion] = guessServiceRegion(this.url);
    this.service = service || guessedService || "";
    this.region = region || guessedRegion || "us-east-1";
    this.cache = cache || new Map();
    this.datetime = datetime || new Date().toISOString().replace(/[:-]|\.\d{3}/g, "");
    this.signQuery = signQuery;
    this.appendSessionToken = appendSessionToken || this.service === "iotdevicegateway";
    this.headers.delete("Host");
    if (this.service === "s3" && !this.signQuery && !this.headers.has("X-Amz-Content-Sha256")) {
      this.headers.set("X-Amz-Content-Sha256", "UNSIGNED-PAYLOAD");
    }
    const params = this.signQuery ? this.url.searchParams : this.headers;
    params.set("X-Amz-Date", this.datetime);
    if (this.sessionToken && !this.appendSessionToken) params.set("X-Amz-Security-Token", this.sessionToken);
    this.signableHeaders = ["host", ...this.headers.keys()].filter(h => allHeaders || !UNSIGNABLE_HEADERS.has(h)).sort();
    this.signedHeaders = this.signableHeaders.join(";");
    this.canonicalHeaders = this.signableHeaders.map(h => h + ":" + (h === "host" ? this.url.host : (this.headers.get(h) || "").replace(/\s+/g, " "))).join("\n");
    this.credentialString = [this.datetime.slice(0, 8), this.region, this.service, "aws4_request"].join("/");
    if (this.signQuery) {
      if (this.service === "s3" && !params.has("X-Amz-Expires")) params.set("X-Amz-Expires", "86400");
      params.set("X-Amz-Algorithm", "AWS4-HMAC-SHA256");
      params.set("X-Amz-Credential", this.accesskeyID + "/" + this.credentialString);
      params.set("X-Amz-SignedHeaders", this.signedHeaders);
    }
    if (this.service === "s3") {
      try {
        this.encodedPath = decodeURIComponent(this.url.pathname.replace(/\+/g, " "));
      } catch {
        this.encodedPath = this.url.pathname;
      }
    } else {
      this.encodedPath = this.url.pathname.replace(/\/+/g, "/");
    }
    if (!singleEncode) this.encodedPath = encodeURIComponent(this.encodedPath).replace(/%2F/g, "/");
    this.encodedPath = encodeRfc3986(this.encodedPath);
    const seenKeys = new Set();
    this.encodedSearch = [...this.url.searchParams]
      .filter(([k]) => !(this.service === "s3" && (!k || seenKeys.has(k))) && (k && (this.service !== "s3" || (seenKeys.add(k), true))))
      .map(p => p.map(p => encodeRfc3986(encodeURIComponent(p))))
      .sort(([k1, v1], [k2, v2]) => k1 < k2 ? -1 : k1 > k2 ? 1 : v1 < v2 ? -1 : v1 > v2 ? 1 : 0)
      .map(p => p.join("="))
      .join("&");
  }

  async sign() {
    if (this.signQuery) {
      this.url.searchParams.set("X-Amz-Signature", await this.signature());
      if (this.sessionToken && this.appendSessionToken) this.url.searchParams.set("X-Amz-Security-Token", this.sessionToken);
    } else {
      this.headers.set("Authorization", await this.authHeader());
    }
    return { method: this.method, url: this.url, headers: this.headers, body: this.body };
  }

  async authHeader() {
    return `AWS4-HMAC-SHA256 Credential=${this.accesskeyID}/${this.credentialString}, SignedHeaders=${this.signedHeaders}, Signature=${await this.signature()}`;
  }

  async signature() {
    const date = this.datetime.slice(0, 8);
    const cacheKey = [this.secretAccessKey, date, this.region, this.service].join();
    let k = this.cache.get(cacheKey);
    if (!k) {
      const kDate = await hmac("AWS4" + this.secretAccessKey, date);
      const kRegion = await hmac(kDate, this.region);
      const kService = await hmac(kRegion, this.service);
      k = await hmac(kService, "aws4_request");
      this.cache.set(cacheKey, k);
    }
    return buf2hex(await hmac(k, await this.stringToSign()));
  }

  async stringToSign() {
    return ["AWS4-HMAC-SHA256", this.datetime, this.credentialString, buf2hex(await hash(await this.canonicalString()))].join("\n");
  }

  async canonicalString() {
    return [this.method.toUpperCase(), this.encodedPath, this.encodedSearch, this.canonicalHeaders + "\n", this.signedHeaders, await this.hexBodyHash()].join("\n");
  }

  async hexBodyHash() {
    let h = this.headers.get("X-Amz-Content-Sha256") || (this.service === "s3" && this.signQuery ? "UNSIGNED-PAYLOAD" : null);
    if (h == null) {
      if (this.body && typeof this.body !== "string" && !("byteLength" in this.body)) throw new Error("body must be string or ArrayBuffer");
      h = buf2hex(await hash(this.body || ""));
    }
    return h;
  }
}

async function hmac(key, string) {
  const k = await crypto.subtle.importKey(
    "raw",
    typeof key === "string" ? encoder.encode(key) : key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", k, encoder.encode(string));
}

async function hash(content) {
  return crypto.subtle.digest("SHA-256", typeof content === "string" ? encoder.encode(content) : content);
}

function buf2hex(b) {
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}

function encodeRfc3986(s) {
  return s.replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
}

function guessServiceRegion(url) {
  const { hostname } = url;
  if (hostname.endsWith(".backblazeb2.com")) {
    const m = hostname.match(/^s3\.([\w-]+)\.backblazeb2\.com$/);
    if (m) return ["s3", m[1]];
  }
  return ["", ""];
}