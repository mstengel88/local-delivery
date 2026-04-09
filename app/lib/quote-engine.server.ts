export async function getFullQuote({
  admin,
  items,
  address,
}: any) {
  const lineItems = items.map((item: any) => ({
    variantId: item.variantId,
    quantity: item.quantity,
  }));

  const response = await admin.graphql(`
    mutation draftOrderCalculate($input: DraftOrderInput!) {
      draftOrderCalculate(input: $input) {
        calculatedDraftOrder {
          subtotalPrice
          totalShippingPrice
          totalTax
          totalPrice
          availableShippingRates {
            handle
            title
            price {
              amount
            }
          }
        }
      }
    }
  `, {
    variables: {
      input: {
        lineItems,
        shippingAddress: {
          address1: address.address1,
          city: address.city,
          province: address.province,
          country: address.country,
          zip: address.postalCode,
        },
      },
    },
  });

  const json = await response.json();
  const result = json.data.draftOrderCalculate.calculatedDraftOrder;

  return {
    subtotal: Number(result.subtotalPrice),
    shipping: Number(result.totalShippingPrice),
    tax: Number(result.totalTax),
    total: Number(result.totalPrice),
    rates: result.availableShippingRates,
  };
}