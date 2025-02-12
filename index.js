require("dotenv").config();
const express = require("express");
const app = express();
const cors = require("cors");
const jwt = require("jsonwebtoken");

const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const uri = process.env.MONGODB_URI;
app.use(express.json());

app.use(
  cors({ origin: ["https://nin-supply.vercel.app", "http://localhost:5173"] })
);


// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    // Create a database and collection
    const usersCollection = client.db("NiNSupply").collection("users");
    const productsCollection = client.db("NiNSupply").collection("products");
    const categoryCollection = client.db("NiNSupply").collection("category");
    const cartsCollection = client.db("NiNSupply").collection("carts");
    const orderCollection = client.db("NiNSupply").collection("all-orders");

    // JWT
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, { expiresIn: "1h" });
      res.send({ token });
    });

    // Verify Token
    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      
      const token = req.headers.authorization.split(" ")[1];
      
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err || !decoded) {
          return res.status(401).send({ message: "Token expired or unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
    };
    

    // Verify Admin
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await usersCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // User Related api
    app.post("/createUser", async (req, res) => {
      const user = req.body;
      const query = { email: user.email };
      const existingUser = await usersCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "user already exists", insertedId: null });
      }
      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get("/users/:email", async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await usersCollection.findOne(query);
      res.send(result);
    });

    // User related API

    // Update user's role (PATCH request)
    app.patch("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const { id } = req.params;
      const { role } = req.body;

      // Find the user by ID and update their role
      const query = { _id: new ObjectId(id) };
      const update = { $set: { role: role } };
      const result = await usersCollection.updateOne(query, update);
      res.send(result);
    });

    // Delete user (DELETE request)
    app.delete("/users/:id", verifyToken, verifyAdmin, async (req, res) => {
      const { id } = req.params;
      const query = { _id: new ObjectId(id) };
      const result = await usersCollection.deleteOne(query);
      res.send(result);
    });


    app.get("/allUsers", verifyToken, verifyAdmin, async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });



    // Product Related api
    app.post("/createProduct", verifyToken, verifyAdmin, async (req, res) => {
      const product = req.body;
      const result = await productsCollection.insertOne(product);
      res.send(result);
    });


    app.get("/products", async (req, res) => {
      const result = await productsCollection.find().toArray();
      res.send(result);
    });

    app.get("/category", async (req, res) => {
      const result = await categoryCollection.find().toArray();
      res.send(result);
    });

    // Carts Related api
    app.get("/carts", async (req, res) => {
      const email = req.query.email;
      if (!email) {
        return res.status(400).send({ message: "User email is required" });
      }
      const query = { userEmail: email };
      const result = await cartsCollection.find(query).toArray();
      res.send(result);
    });
    

    app.post("/carts", async (req, res) => {
      const cartsItems = req.body;
      const result = await cartsCollection.insertOne(cartsItems);
      res.send(result);
    });

    app.delete("/carts/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await cartsCollection.deleteOne(query);
      res.send(result);
    });

    app.put("/carts/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const update = { $set: req.body };
      const result = await cartsCollection.updateOne(query, update);
      res.send(result);
    });

    // order Related api
    app.post("/orders", async (req, res) => {
      const order = req.body;
      const result = await orderCollection.insertOne(order);
      res.send(result);
    });

    app.get("/orders", async (req, res) => {
      const email = req.query.email;
      const query = { userEmail: email };
      const result = await orderCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/allOrders", async (req, res) => {
      const result = await orderCollection.find().toArray();
      res.send(result);
    });

    // Calculate Total Revenue for Different Order Statuses
    app.get("/totalRevenue", async (req, res) => {
      const result = await orderCollection.aggregate([
        {
          $group: {
            _id: "$status", // Group by status
            totalRevenue: { $sum: "$totalPrice" }, // Sum the totalPrice for each status
          }
        }
      ]).toArray();

      // Format the result with default values
      const revenueData = {
        pending: 0,
        processing: 0,
        completed: 0,
      };

      // Map the result to corresponding statuses
      result.forEach(item => {
        if (item._id === "Pending") {
          revenueData.pending = item.totalRevenue;
        } else if (item._id === "Processing") {
          revenueData.processing = item.totalRevenue;
        } else if (item._id === "Complete") {
          revenueData.completed = item.totalRevenue;
        }
      });

      res.send(revenueData); // Send the revenue data for each status
    });




    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello World! This is a base template for a Node.js server.");
});

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
