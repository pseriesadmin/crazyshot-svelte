export async function load({ params }: { params: { id: string } }) {
	return {
		params: {
			id: parseInt(params.id, 10)
		}
	};
}
