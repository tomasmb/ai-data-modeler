import React from 'react';

const EXAMPLE_SCHEMA = `// E-commerce Data Model Example
entity Product {
  id: ID
  name: string
  description: string
  price: number
  inStock: boolean
  createdAt: datetime
  sku: string
  // References category by name instead of id
  category: Category.name
  // References Review entity with many relationship
  reviews: Review[]
}

entity Category {
  id: ID
  name: string
  description: string
  slug: string
  products: Product[]
}

entity Review {
  id: ID
  rating: number
  comment: string
  createdAt: datetime
  // References product by SKU
  product: Product.sku
  // References user by email
  user: User.email
}

entity User {
  id: ID
  email: string
  name: string
  reviews: Review[]
  orders: Order[]
}

entity Order {
  id: ID
  orderNumber: string
  totalAmount: number
  status: string
  createdAt: datetime
  // References user by email
  user: User.email
  items: OrderItem[]
}

entity OrderItem {
  id: ID
  quantity: number
  price: number
  // References order by orderNumber
  order: Order.orderNumber
  // References product by SKU
  product: Product.sku
}`;

export const ExampleSchemaModal = ({ isOpen, onClose, onApply }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full max-w-4xl">
        <div className="flex justify-between items-center p-4 border-b">
          <h2 className="text-xl font-semibold">Example Data Model</h2>
          <button
            className="text-gray-600 hover:text-gray-800"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="p-4">
          <pre className="bg-gray-50 p-4 rounded overflow-auto max-h-[60vh]">
            <code>{EXAMPLE_SCHEMA}</code>
          </pre>
        </div>
        <div className="flex justify-end gap-2 p-4 border-t">
          <button
            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded"
            onClick={onClose}
          >
            Close
          </button>
          <button
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            onClick={() => {
              onApply(EXAMPLE_SCHEMA);
              onClose();
            }}
          >
            Use This Example
          </button>
        </div>
      </div>
    </div>
  );
}; 