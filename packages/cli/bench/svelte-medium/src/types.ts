export interface Item {
  id: string;
  name: string;
  category: string;
  brand: string;
  price: number;
  rating: number;
  reviews: number;
  stock: number;
  image: string;
  specs: string[];
}

export interface CartLineData {
  id: string;
  name: string;
  brand: string;
  price: number;
  qty: number;
}
