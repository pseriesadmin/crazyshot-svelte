export async function load({ params }: { params: { id: string } }) {
	return {
		params: {
			id: params.id // UUID as string — no parseInt
		}
	};
}
