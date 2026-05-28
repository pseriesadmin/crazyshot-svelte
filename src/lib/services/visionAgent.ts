import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
	apiKey: import.meta.env.VITE_ANTHROPIC_API_KEY
});

export interface VisionAnalysisResult {
	confidence: number;
	condition: 'excellent' | 'good' | 'fair' | 'damaged';
	description: string;
	damagePoints?: string[];
	estimatedRepairCost?: number;
}

export async function analyzeEquipmentCondition(
	imageUrl: string
): Promise<VisionAnalysisResult> {
	try {
		const response = await client.messages.create({
			model: 'claude-3-5-sonnet-20241022',
			max_tokens: 1024,
			messages: [
				{
					role: 'user',
					content: [
						{
							type: 'image',
							source: {
								type: 'url',
								url: imageUrl
							}
						},
						{
							type: 'text',
							text: `카메라 장비 상태를 분석해주세요. 다음 정보를 JSON 형식으로 반환하세요:
{
  "condition": "excellent|good|fair|damaged",
  "confidence": 0.0-1.0,
  "description": "장비 상태 설명",
  "damagePoints": ["손상 부위 1", "손상 부위 2"],
  "estimatedRepairCost": 수리 예상 비용 (원)
}`
						}
					]
				}
			]
		});

		const content = response.content[0];
		if (content.type !== 'text') {
			throw new Error('Unexpected response type');
		}

		const parsed = JSON.parse(content.text);
		return {
			confidence: parsed.confidence || 0.5,
			condition: parsed.condition || 'fair',
			description: parsed.description || '분석 불가',
			damagePoints: parsed.damagePoints,
			estimatedRepairCost: parsed.estimatedRepairCost
		};
	} catch (error) {
		console.error('Vision Agent 분석 실패:', error);
		throw error;
	}
}

export async function recommendEquipment(userPreferences: {
	budget?: number;
	purpose?: string;
	duration?: string;
}): Promise<string> {
	try {
		const response = await client.messages.create({
			model: 'claude-3-5-sonnet-20241022',
			max_tokens: 1024,
			messages: [
				{
					role: 'user',
					content: `사용자의 장비 선택을 도와주세요.
예산: ${userPreferences.budget ? `${userPreferences.budget.toLocaleString()}원` : '무제한'}
목적: ${userPreferences.purpose || '미지정'}
사용 기간: ${userPreferences.duration || '미지정'}

적절한 카메라 장비를 추천하고 이유를 설명해주세요.`
				}
			]
		});

		const content = response.content[0];
		if (content.type !== 'text') {
			throw new Error('Unexpected response type');
		}

		return content.text;
	} catch (error) {
		console.error('장비 추천 실패:', error);
		throw error;
	}
}
