import axios from 'axios';
import * as cheerio from 'cheerio';
import { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import { URL } from 'url';

const prisma = new PrismaClient();

interface RobotsCheckResult {
  allowed: boolean;
  reason?: string;
}

interface PolicyField {
  field: string;
  value: any;
  confidence: number;
  evidence?: {
    snippet: string;
    start_index: number;
    end_index: number;
    source_url: string;
  };
}

interface ParsedPolicy {
  warranty_length_months: number | null;
  coverage: {
    parts: boolean | null;
    labor: boolean | null;
    electronics: boolean | null;
    battery: boolean | null;
  };
  transferable: boolean | null;
  registration_required: boolean | null;
  registration_window_days: number | null;
  exclusions: string[];
  repair_SLA_days: number | null;
  refund_window_days: number | null;
  arbitration_clause: boolean | null;
  policy_confidence: number;
}

interface ParseResult {
  allowed: boolean;
  reason?: string;
  parsed?: ParsedPolicy;
  summary?: string;
  evidence?: PolicyField[];
  source_url?: string;
  fetched_at?: string;
  raw_ref?: string;
}

export class PolicyParser {
  private openai: OpenAI | null = null;

  constructor() {
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
    }
  }

  async checkRobotsTxt(url: string): Promise<RobotsCheckResult> {
    try {
      const parsedUrl = new URL(url);
      const robotsUrl = `${parsedUrl.protocol}//${parsedUrl.hostname}/robots.txt`;

      const response = await axios.get(robotsUrl, {
        timeout: 5000,
        headers: {
          'User-Agent': 'TrustAsAService/1.0 (https://trustasaservice.com)',
        },
      });

      const robotsContent = response.data;
      const lines = robotsContent.split('\n');

      let isOurAgent = false;

      for (const line of lines) {
        const trimmedLine = line.trim().toLowerCase();

        if (trimmedLine.startsWith('user-agent:')) {
          const agent = trimmedLine.replace('user-agent:', '').trim();
          isOurAgent = agent === '*' || agent === 'trustasaservice';
        }

        if (isOurAgent && trimmedLine.startsWith('disallow:')) {
          const disallowedPath = trimmedLine.replace('disallow:', '').trim();
          const urlPath = parsedUrl.pathname;

          if (disallowedPath === '/' ||
              (disallowedPath && urlPath.startsWith(disallowedPath))) {
            // Log to file
            this.logRobotsDisallow(url, 'robots_disallow');
            return { allowed: false, reason: 'robots_disallow' };
          }
        }
      }

      return { allowed: true };
    } catch (error) {
      // If robots.txt doesn't exist or is inaccessible, assume allowed
      console.error('Error checking robots.txt:', error);
      return { allowed: true };
    }
  }

  private logRobotsDisallow(url: string, reason: string): void {
    const logDir = path.join(__dirname, '../../logs');
    const logFile = path.join(logDir, 'parsing_robots.log');

    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }

    const logEntry = `${new Date().toISOString()} - ${url} - ${reason}\n`;
    fs.appendFileSync(logFile, logEntry);
  }

  private extractTextFromHtml(html: string): string {
    const $ = cheerio.load(html);

    // Remove script and style elements
    $('script, style').remove();

    // Get text content
    return $('body').text().replace(/\s+/g, ' ').trim();
  }

  private applyRegexExtraction(text: string): {
    fields: Partial<ParsedPolicy>;
    evidence: PolicyField[];
  } {
    const fields: Partial<ParsedPolicy> = {
      coverage: {
        parts: null,
        labor: null,
        electronics: null,
        battery: null,
      },
      exclusions: [],
    };
    const evidence: PolicyField[] = [];

    // Extract warranty length
    const warrantyRegex = /(\d+)\s*(year|years|month|months|mo)/gi;
    const warrantyMatch = text.match(warrantyRegex);
    if (warrantyMatch) {
      const match = warrantyMatch[0];
      const numberMatch = match.match(/(\d+)/);
      const unitMatch = match.match(/(year|years|month|months|mo)/i);

      if (numberMatch && unitMatch) {
        const value = parseInt(numberMatch[1]);
        const unit = unitMatch[1].toLowerCase();
        const months = unit.startsWith('year') ? value * 12 : value;

        fields.warranty_length_months = months;
        evidence.push({
          field: 'warranty_length_months',
          value: months,
          confidence: 0.95,
          evidence: {
            snippet: match,
            start_index: text.indexOf(match),
            end_index: text.indexOf(match) + match.length,
            source_url: '',
          },
        });
      }
    }

    // Extract coverage terms
    const coveragePatterns = {
      parts: /covers?\s+(replacement\s+)?parts/i,
      labor: /covers?\s+labor/i,
      electronics: /electronic\s+components?\s+(are\s+)?covered/i,
      battery: /(battery|batteries)\s+(is|are)\s+(covered|excluded)/i,
    };

    for (const [key, pattern] of Object.entries(coveragePatterns)) {
      const match = text.match(pattern);
      if (match) {
        const isExcluded = match[0].toLowerCase().includes('excluded');
        (fields.coverage as any)[key] = !isExcluded;

        evidence.push({
          field: `coverage.${key}`,
          value: !isExcluded,
          confidence: 0.9,
          evidence: {
            snippet: match[0],
            start_index: text.indexOf(match[0]),
            end_index: text.indexOf(match[0]) + match[0].length,
            source_url: '',
          },
        });
      }
    }

    // Extract transferability
    const transferPattern = /(non-?transferable|transferable|transfer)/i;
    const transferMatch = text.match(transferPattern);
    if (transferMatch) {
      const isTransferable = !transferMatch[0].toLowerCase().includes('non');
      fields.transferable = isTransferable;

      evidence.push({
        field: 'transferable',
        value: isTransferable,
        confidence: 0.95,
        evidence: {
          snippet: transferMatch[0],
          start_index: text.indexOf(transferMatch[0]),
          end_index: text.indexOf(transferMatch[0]) + transferMatch[0].length,
          source_url: '',
        },
      });
    }

    // Extract registration requirements
    const registrationPattern = /register\s+(within|the\s+product)?\s*(\d+)?\s*days?/i;
    const regMatch = text.match(registrationPattern);
    if (regMatch) {
      fields.registration_required = true;

      const daysMatch = regMatch[0].match(/(\d+)\s*days?/i);
      if (daysMatch) {
        fields.registration_window_days = parseInt(daysMatch[1]);
      }

      evidence.push({
        field: 'registration_required',
        value: true,
        confidence: 0.9,
        evidence: {
          snippet: regMatch[0],
          start_index: text.indexOf(regMatch[0]),
          end_index: text.indexOf(regMatch[0]) + regMatch[0].length,
          source_url: '',
        },
      });
    }

    // Extract exclusions
    const exclusionsPattern = /((damage|damages)\s+(caused\s+by|from|due\s+to))\s+([^.]+)/gi;
    const exclusionMatches = text.matchAll(exclusionsPattern);
    for (const match of exclusionMatches) {
      const exclusion = match[4].trim().substring(0, 50);
      fields.exclusions!.push(exclusion);
    }

    // Extract refund window
    const refundPattern = /(\d+)[\s-]?days?\s+(return|refund|money[\s-]?back)/i;
    const refundMatch = text.match(refundPattern);
    if (refundMatch) {
      const daysMatch = refundMatch[0].match(/(\d+)/);
      if (daysMatch) {
        fields.refund_window_days = parseInt(daysMatch[1]);

        evidence.push({
          field: 'refund_window_days',
          value: parseInt(daysMatch[1]),
          confidence: 0.9,
          evidence: {
            snippet: refundMatch[0],
            start_index: text.indexOf(refundMatch[0]),
            end_index: text.indexOf(refundMatch[0]) + refundMatch[0].length,
            source_url: '',
          },
        });
      }
    }

    // Extract arbitration clause
    const arbitrationPattern = /arbitration|binding\s+arbitration|arbitrate/i;
    const arbitrationMatch = text.match(arbitrationPattern);
    if (arbitrationMatch) {
      fields.arbitration_clause = true;

      evidence.push({
        field: 'arbitration_clause',
        value: true,
        confidence: 0.85,
        evidence: {
          snippet: arbitrationMatch[0],
          start_index: text.indexOf(arbitrationMatch[0]),
          end_index: text.indexOf(arbitrationMatch[0]) + arbitrationMatch[0].length,
          source_url: '',
        },
      });
    }

    return { fields, evidence };
  }

  private async extractWithLLM(text: string): Promise<{
    parsed: ParsedPolicy;
    evidence: PolicyField[];
    confidence: number;
  }> {
    if (!this.openai) {
      throw new Error('OpenAI API key not configured');
    }

    const systemPrompt = `You are a strict extractor. Output ONLY valid JSON matching this schema. If unknown use null. Provide per-field confidence 0.0-1.0.`;

    const userPrompt = `Here is the text: ---BEGIN---${text.substring(0, 4000)}---END---. Return:
{
  "parsed": {
    "warranty_length_months": number or null,
    "coverage": {
      "parts": boolean or null,
      "labor": boolean or null,
      "electronics": boolean or null,
      "battery": boolean or null
    },
    "transferable": boolean or null,
    "registration_required": boolean or null,
    "registration_window_days": number or null,
    "exclusions": string array,
    "repair_SLA_days": number or null,
    "refund_window_days": number or null,
    "arbitration_clause": boolean or null
  },
  "evidence": [
    {
      "field": "field_name",
      "snippet": "relevant text snippet",
      "start_index": 0,
      "end_index": 0,
      "confidence": 0.92
    }
  ],
  "overall_confidence": 0.90
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 1000
      });

      const result = JSON.parse(response.choices[0].message.content || '{}');

      // Validate and clean the result
      const parsed: ParsedPolicy = {
        warranty_length_months: result.parsed?.warranty_length_months || null,
        coverage: {
          parts: result.parsed?.coverage?.parts || null,
          labor: result.parsed?.coverage?.labor || null,
          electronics: result.parsed?.coverage?.electronics || null,
          battery: result.parsed?.coverage?.battery || null,
        },
        transferable: result.parsed?.transferable || null,
        registration_required: result.parsed?.registration_required || null,
        registration_window_days: result.parsed?.registration_window_days || null,
        exclusions: result.parsed?.exclusions || [],
        repair_SLA_days: result.parsed?.repair_SLA_days || null,
        refund_window_days: result.parsed?.refund_window_days || null,
        arbitration_clause: result.parsed?.arbitration_clause || null,
        policy_confidence: result.overall_confidence || 0.5,
      };

      const evidence = (result.evidence || []).map((e: any) => ({
        field: e.field,
        value: (parsed as any)[e.field],
        confidence: e.confidence || 0.5,
        evidence: {
          snippet: e.snippet || '',
          start_index: e.start_index || 0,
          end_index: e.end_index || 0,
          source_url: '',
        },
      }));

      return {
        parsed,
        evidence,
        confidence: result.overall_confidence || 0.5,
      };
    } catch (error) {
      console.error('LLM extraction error:', error);
      // Return empty result on error
      return {
        parsed: {
          warranty_length_months: null,
          coverage: { parts: null, labor: null, electronics: null, battery: null },
          transferable: null,
          registration_required: null,
          registration_window_days: null,
          exclusions: [],
          repair_SLA_days: null,
          refund_window_days: null,
          arbitration_clause: null,
          policy_confidence: 0.1,
        },
        evidence: [],
        confidence: 0.1,
      };
    }
  }

  private async generateSummary(parsed: ParsedPolicy): Promise<string> {
    const parts = [];

    if (parsed.warranty_length_months) {
      parts.push(`${parsed.warranty_length_months}-month warranty`);
    }

    const coverage = [];
    if (parsed.coverage.parts) coverage.push('parts');
    if (parsed.coverage.labor) coverage.push('labor');
    if (parsed.coverage.battery === false) coverage.push('battery excluded');

    if (coverage.length > 0) {
      parts.push(`covering ${coverage.join(' & ')}`);
    }

    if (parsed.registration_required) {
      parts.push(`registration required${parsed.registration_window_days ? ` within ${parsed.registration_window_days} days` : ''}`);
    }

    if (parsed.transferable !== null) {
      parts.push(parsed.transferable ? 'transferable' : 'non-transferable');
    }

    let summary = parts.join(', ');
    if (summary.length > 280) {
      summary = summary.substring(0, 277) + '...';
    }

    return summary.charAt(0).toUpperCase() + summary.slice(1) + '.';
  }

  private async storeRawContent(content: string, _url: string): Promise<string> {
    // Store in local storage for MVP (in production, use S3)
    const storageDir = path.join(__dirname, '../../storage/raw');
    if (!fs.existsSync(storageDir)) {
      fs.mkdirSync(storageDir, { recursive: true });
    }

    const fileName = `policy-${Date.now()}-${Math.random().toString(36).substring(7)}.html`;
    const filePath = path.join(storageDir, fileName);

    fs.writeFileSync(filePath, content);

    return `local://storage/raw/${fileName}`;
  }

  async parse(
    rawHtml: string,
    sourceUrl: string,
    _localeHint?: string
  ): Promise<ParseResult> {
    // Step 1: Check robots.txt
    const robotsCheck = await this.checkRobotsTxt(sourceUrl);
    if (!robotsCheck.allowed) {
      return {
        allowed: false,
        reason: robotsCheck.reason,
      };
    }

    // Step 2: Extract text from HTML
    const text = this.extractTextFromHtml(rawHtml);

    // Step 3: Apply regex extraction first
    const { fields: regexFields, evidence: regexEvidence } = this.applyRegexExtraction(text);

    // Step 4: Calculate initial confidence based on regex matches
    const regexFieldCount = Object.keys(regexFields).filter(
      key => (regexFields as any)[key] !== null && (regexFields as any)[key] !== undefined
    ).length;

    let finalParsed: ParsedPolicy;
    let finalEvidence: PolicyField[] = regexEvidence;
    let confidence = regexFieldCount > 5 ? 0.9 : regexFieldCount > 3 ? 0.7 : 0.4;

    // Step 5: Use LLM if confidence is low or critical fields are missing
    if (confidence < 0.7 || !regexFields.warranty_length_months) {
      try {
        const llmResult = await this.extractWithLLM(text);

        // Merge results, preferring regex when confident
        finalParsed = {
          warranty_length_months: regexFields.warranty_length_months || llmResult.parsed.warranty_length_months,
          coverage: {
            parts: regexFields.coverage?.parts !== null ? (regexFields.coverage?.parts ?? null) : llmResult.parsed.coverage.parts,
            labor: regexFields.coverage?.labor !== null ? (regexFields.coverage?.labor ?? null) : llmResult.parsed.coverage.labor,
            electronics: regexFields.coverage?.electronics !== null ? (regexFields.coverage?.electronics ?? null) : llmResult.parsed.coverage.electronics,
            battery: regexFields.coverage?.battery !== null ? (regexFields.coverage?.battery ?? null) : llmResult.parsed.coverage.battery,
          },
          transferable: regexFields.transferable !== undefined ? regexFields.transferable : llmResult.parsed.transferable,
          registration_required: regexFields.registration_required !== undefined ? regexFields.registration_required : llmResult.parsed.registration_required,
          registration_window_days: regexFields.registration_window_days || llmResult.parsed.registration_window_days,
          exclusions: [...(regexFields.exclusions || []), ...llmResult.parsed.exclusions],
          repair_SLA_days: regexFields.repair_SLA_days || llmResult.parsed.repair_SLA_days,
          refund_window_days: regexFields.refund_window_days || llmResult.parsed.refund_window_days,
          arbitration_clause: regexFields.arbitration_clause !== undefined ? regexFields.arbitration_clause : llmResult.parsed.arbitration_clause,
          policy_confidence: (confidence + llmResult.confidence) / 2,
        };

        finalEvidence = [...regexEvidence, ...llmResult.evidence];
      } catch (error) {
        // Fall back to regex-only results
        finalParsed = {
          ...regexFields,
          warranty_length_months: regexFields.warranty_length_months || null,
          coverage: regexFields.coverage || { parts: null, labor: null, electronics: null, battery: null },
          transferable: regexFields.transferable || null,
          registration_required: regexFields.registration_required || null,
          registration_window_days: regexFields.registration_window_days || null,
          exclusions: regexFields.exclusions || [],
          repair_SLA_days: regexFields.repair_SLA_days || null,
          refund_window_days: regexFields.refund_window_days || null,
          arbitration_clause: regexFields.arbitration_clause || null,
          policy_confidence: confidence,
        } as ParsedPolicy;
      }
    } else {
      // Use regex results if confidence is high
      finalParsed = {
        ...regexFields,
        warranty_length_months: regexFields.warranty_length_months || null,
        coverage: regexFields.coverage || { parts: null, labor: null, electronics: null, battery: null },
        transferable: regexFields.transferable || null,
        registration_required: regexFields.registration_required || null,
        registration_window_days: regexFields.registration_window_days || null,
        exclusions: regexFields.exclusions || [],
        repair_SLA_days: regexFields.repair_SLA_days || null,
        refund_window_days: regexFields.refund_window_days || null,
        arbitration_clause: regexFields.arbitration_clause || null,
        policy_confidence: confidence,
      } as ParsedPolicy;
    }

    // Step 6: Generate summary
    const summary = await this.generateSummary(finalParsed);

    // Step 7: Store raw content
    const rawRef = await this.storeRawContent(rawHtml, sourceUrl);

    // Update evidence with source URL
    finalEvidence = finalEvidence.map(e => ({
      ...e,
      evidence: e.evidence ? { ...e.evidence, source_url: sourceUrl } : undefined,
    }));

    return {
      allowed: true,
      parsed: finalParsed,
      summary,
      evidence: finalEvidence,
      source_url: sourceUrl,
      fetched_at: new Date().toISOString(),
      raw_ref: rawRef,
    };
  }

  async saveAsEvent(parseResult: ParseResult, productId?: string, companyId?: string): Promise<void> {
    if (!parseResult.allowed || !parseResult.parsed) {
      return;
    }

    await prisma.event.create({
      data: {
        productId,
        companyId,
        source: 'POLICY_PARSER',
        type: 'policy',
        severity: 0, // Policies are not negative events
        detailsJson: {
          parsed: parseResult.parsed,
          summary: parseResult.summary,
          evidence: parseResult.evidence,
        } as any,
        rawUrl: parseResult.source_url,
        rawRef: parseResult.raw_ref,
        parsedAt: new Date(parseResult.fetched_at || Date.now()),
      },
    });
  }
}

export const policyParser = new PolicyParser();