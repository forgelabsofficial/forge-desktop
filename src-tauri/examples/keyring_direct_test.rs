use keyring::Entry;

fn main() {
    println!("Testing keyring with same pattern as unit tests...");
    
    let service = "forge-desktop";
    let account = "test_profile_12345";
    let password = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test";
    
    // Clean up
    if let Ok(entry) = Entry::new(service, account) {
        let _ = entry.delete_credential();
        println!("Cleaned up any existing test credentials");
    }
    
    std::thread::sleep(std::time::Duration::from_millis(200));
    
    // Store - create NEW entry just like in store_token
    println!("\n1. Creating entry for STORE...");
    let entry1 = match Entry::new(service, account) {
        Ok(e) => {
            println!("   ✓ Created entry");
            e
        },
        Err(e) => {
            eprintln!("   ✗ Failed: {}", e);
            return;
        }
    };
    
    println!("2. Storing password...");
    match entry1.set_password(password) {
        Ok(_) => println!("   ✓ Stored"),
        Err(e) => {
            eprintln!("   ✗ Failed: {}", e);
            return;
        }
    }
    
    // Drop entry1 to simulate function return
    drop(entry1);
    println!("   (Dropped store entry)");
    
    // Wait
    std::thread::sleep(std::time::Duration::from_millis(200));
    
    // Retrieve - create NEW entry just like in get_token
    println!("\n3. Creating NEW entry for GET...");
    let entry2 = match Entry::new(service, account) {
        Ok(e) => {
            println!("   ✓ Created entry");
            e
        },
        Err(e) => {
            eprintln!("   ✗ Failed: {}", e);
            return;
        }
    };
    
    println!("4. Retrieving password...");
    match entry2.get_password() {
        Ok(retrieved) => {
            if retrieved == password {
                println!("   ✓ Retrieved and matches!");
            } else {
                eprintln!("   ✗ Doesn't match: got '{}', expected '{}'", retrieved, password);
            }
        },
        Err(e) => {
            eprintln!("   ✗ Failed: {}", e);
            return;
        }
    }
    
    // Clean up
    println!("\n5. Cleaning up...");
    match entry2.delete_credential() {
        Ok(_) => println!("   ✓ Deleted"),
        Err(e) => eprintln!("   ✗ Failed: {}", e),
    }
    
    println!("\nTest completed!");
}
